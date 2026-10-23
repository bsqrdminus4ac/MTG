import { hasCardType, hasKeyword, tapPermanent } from "./cards";
import { getCardName, getCharacteristics } from "./characteristics";
import { chooseMany, chooseOne, objectChoice, playerChoice, type Choice } from "./decisions";
import { damageObject, damagePlayer } from "./effects";
import { applySequentially, fail, givePriorityToActivePlayer, ok, type ApplyResult } from "./engine";
import type { GameEvent } from "./events";
import type { ObjectId } from "./ids";
import { openDecision } from "./prompts";
import type { AttackableTarget, GameState, Target } from "./state";

export interface CombatInProgress {
    rollback: GameState;
    attackers: Readonly<Record<ObjectId, CombatInfo>>;
    currentTargetDecision?: ObjectId | undefined;
}

export interface CombatInfo {
    id: ObjectId;
    attackableTargets?: AttackableTarget[] | undefined;
    attackTarget?: AttackableTarget;
    blockedBy?: readonly ObjectId[];
}

export const isAttacking = (state: GameState, object: ObjectId): boolean => state.combat !== null && state.combat.attackers[object]?.attackTarget !== undefined;
export const isBlocking = (state: GameState, object: ObjectId): boolean => {
    if (!state.combat) return false;
    for (const info of Object.values(state.combat.attackers)) {
        if (info.blockedBy && info.blockedBy.includes(object)) return true;
    }
    return false;
};
export const isBlocked = (state: GameState, object: ObjectId): boolean => state.combat !== null && (state.combat.attackers[object]?.blockedBy?.length ?? 0) > 0;

//#region Declare Attackers

export function beginCombat(state: GameState): ApplyResult {
    if (state.combat) return fail("Combat already in progress");
    if (state.turn.step !== "declareAttackers") return fail("Combat can only begin during the declare attackers step");

    const creaturesThatCanAttack: ObjectId[] = [];
    for (const objId of state.battlefield) {
        if (hasCardType(state, objId, "Creature") && canCreatureAttack(state, objId)) {
            creaturesThatCanAttack.push(objId);
        }
    }

    if (creaturesThatCanAttack.length === 0) return ok(state, []);

    const options: Choice[] = creaturesThatCanAttack.map((obj) => objectChoice(obj, getCardName(state, obj)));
    const combatProgress: CombatInProgress = { rollback: state, attackers: {} };
    return ok(
        openDecision({ ...state, combat: combatProgress }, (id) =>
            chooseMany({
                id,
                min: 0,
                max: options.length,
                options,
                player: state.turn.activePlayer,
                prompt: "Choose attackers",
                then: { kind: "selectAttackers" },
            }),
        ),
        [],
    );
}

export function applyAttackSelectionDecision(state: GameState, selection: readonly Choice[]): ApplyResult {
    if (state.turn.step !== "declareAttackers") return fail("Attackers can only be selected during the declare attackers step");
    if (!state.combat) return fail("Can't select attackers before combat has started");
    if (selection.length === 0) {
        return ok({ ...state, combat: null }, []);
    }
    const attackers: Record<ObjectId, CombatInfo> = {};
    for (const choice of selection) {
        if (choice.value.kind !== "object") continue;
        const objId = choice.value.id;
        const attackableTargets = getAttackableTargets(state, objId);
        if (attackableTargets.length === 0) continue;
        attackers[objId] =
            attackableTargets.length === 1
                ? {
                      id: objId,
                      attackTarget: attackableTargets[0]!,
                  }
                : {
                      id: objId,
                      attackableTargets: attackableTargets,
                  };
    }
    if (Object.keys(attackers).length === 0) {
        return ok({ ...state, combat: null }, []);
    }
    return chooseAttackTargets({ ...state, combat: { ...state.combat, attackers } });
}

export function chooseAttackTargets(state: GameState): ApplyResult {
    if (state.turn.step !== "declareAttackers") return fail("Attackers can only be selected during the declare attackers step");
    if (!state.combat) return fail("Can't select attack targets before combat has started");
    if (!state.combat.attackers || Object.keys(state.combat.attackers).length === 0) return fail("No legal attackers have been declared");
    for (const attacker of Object.values(state.combat.attackers)) {
        if (attacker.attackableTargets) {
            const options: Choice[] = attacker.attackableTargets.flatMap((target) => {
                if (target.kind === "object") {
                    const obj = state.objects[target.id];
                    if (!obj) return [];
                    return objectChoice(target.id, `Attack ${obj.controller}'s ${getCardName(state, target.id)} (#${target.id})`);
                } else {
                    return playerChoice(target.id, `Attack ${target.id}`);
                }
            });
            if (options.length === 0) {
                // roll back to before attackers were chosen
                return fail("Invalid attack, rollback not yet implemented");
            } else if (options.length > 1) {
                const next = { ...state, combat: { ...state.combat, currentTargetDecision: attacker.id } };
                return ok(
                    openDecision(next, (id) =>
                        chooseOne({
                            id,
                            options,
                            player: next.turn.activePlayer,
                            prompt: `Select target to attack with ${getCardName(next, attacker.id)} (#${attacker.id})`,
                            then: { kind: "selectAttackTargets" },
                            onCancel: { kind: "cancelAttacks" },
                        }),
                    ),
                    [],
                );
            }
        }
    }
    return declareAttacks(state);
}

export function applyAttackTargetDecision(state: GameState, selection: readonly Choice[]): ApplyResult {
    if (state.turn.step !== "declareAttackers") return fail("Attackers can only be selected during the declare attackers step");
    if (!state.combat) return fail("Can't select attack targets before combat has started");
    if (!state.combat.attackers || Object.keys(state.combat.attackers).length === 0) return fail("No legal attackers have been declared");
    if (!state.combat.currentTargetDecision || !(state.combat.currentTargetDecision in state.combat.attackers)) return fail("No attack targeting decision is in progress");
    if (selection.length !== 1 || selection[0] === undefined) return fail("Must select exactly one target to attack");
    const attackers = { ...state.combat.attackers };
    let target: AttackableTarget;
    if (selection[0].value.kind === "object") {
        target = { kind: "object", id: selection[0].value.id };
    } else if (selection[0].value.kind === "player") {
        target = { kind: "player", id: selection[0].value.id };
    } else return fail("Invalid type of target to attack");
    attackers[state.combat.currentTargetDecision] = { ...attackers[state.combat.currentTargetDecision], attackTarget: target, attackableTargets: undefined, id: state.combat.currentTargetDecision };
    return chooseAttackTargets({ ...state, combat: { ...state.combat, attackers, currentTargetDecision: undefined } });
}

export function declareAttacks(state: GameState): ApplyResult {
    if (state.turn.step !== "declareAttackers") return fail("Attackers can only be declared during the declare attackers step");
    if (!state.combat) return fail("Can't select attack targets before combat has started");
    if (!state.combat.attackers || Object.keys(state.combat.attackers).length === 0) return fail("No legal attackers have been declared");
    if (state.combat.currentTargetDecision) return fail("An attack targeting decision is still in progress");
    if (Object.values(state.combat.attackers).some((a) => !a.attackTarget)) return fail("Not all attackers have a chosen target");
    const result = applySequentially(
        state,
        Object.values(state.combat.attackers).map((a) => (currentState: GameState) => tapPermanent(currentState, a.id)),
    );
    if (!result.ok) return result;
    const attackEvents: GameEvent[] = Object.values(state.combat.attackers).map((a) => ({
        type: "attackDeclared",
        object: a.id,
        cardName: getCardName(result.state, a.id),
        player: state.turn.activePlayer,
        target: a.attackTarget!,
        targetName: a.attackTarget!.kind === "object" ? `${getCardName(result.state, a.attackTarget!.id)} (#${a.attackTarget!.id})` : a.attackTarget!.id,
    }));
    return givePriorityToActivePlayer(result.state, [...result.events, ...attackEvents]);
}

function canCreatureAttack(state: GameState, creature: ObjectId): boolean {
    const obj = state.objects[creature];
    if (!obj) return false;
    if (obj.zone !== "battlefield") return false;
    if (obj.controller !== state.turn.activePlayer) return false;
    if (obj.tapped) return false;
    if (obj.turnEnteredZone === state.turn.number && !hasKeyword(state, creature, "haste")) return false;
    return true;
}

function getAttackableTargets(state: GameState, creature: ObjectId): AttackableTarget[] {
    const targets: AttackableTarget[] = [];
    for (const objId of state.battlefield) {
        const obj = state.objects[objId];
        if (!obj) continue;
        if (obj.controller === state.turn.activePlayer) continue;
        if (!hasCardType(state, objId, "Planeswalker")) continue;
        //TODO: Check attack target restrictions
        targets.push({ kind: "object", id: objId });
    }
    for (const player of Object.values(state.players)) {
        if (player.id === state.turn.activePlayer) continue;
        //TODO: Check attack target restrictions
        targets.push({ kind: "player", id: player.id });
    }
    return targets;
}

//#endregion

//#region Declare Blockers

//#endregion

//#region Combat Damage

export function processCombatDamage(state: GameState, isFirstStrikeStep?: boolean): ApplyResult {
    if (state.turn.step !== "combatDamage") return fail("Combat damage can only be dealt during the combat damage step");
    if (!state.combat) return fail("No combat in progress to process damage for");
    if (!state.combat.attackers || Object.keys(state.combat.attackers).length === 0) return fail("No attackers have been declared");
    return applySequentially(
        state,
        Object.values(state.combat.attackers).map((a) => (currentState: GameState) => dealCombatDamage(currentState, a, isFirstStrikeStep)),
    );
}

function dealCombatDamage(state: GameState, combatInfo: CombatInfo, isFirstStrikeStep?: boolean): ApplyResult {
    if (!combatInfo.attackTarget || !isStillLegalTarget(state, combatInfo.id, combatInfo.attackTarget)) return ok(state, []);
    const obj = state.objects[combatInfo.id];
    if (!obj) return ok(state, []);
    if (obj.zone !== "battlefield") return ok(state, []);
    const chars = getCharacteristics(state, combatInfo.id);
    if (!chars) return ok(state, []);
    if (!chars.power || chars.power <= 0) return ok(state, []);
    //TODO: Check for blockers
    if (combatInfo.attackTarget.kind === "object") {
        return damageObject(state, combatInfo.attackTarget.id, combatInfo.id, chars.power, true);
    } else {
        return damagePlayer(state, combatInfo.attackTarget.id, combatInfo.id, chars.power, true);
    }
}

function isStillLegalTarget(state: GameState, objId: ObjectId, target: AttackableTarget): boolean {
    //TODO: Re-evaluate target legality before damage
    return true;
}

////#endregion
