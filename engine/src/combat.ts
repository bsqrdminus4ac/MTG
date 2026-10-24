import { hasCardType, hasKeyword, tapPermanent } from "./cards";
import { getCardName, getCharacteristics } from "./characteristics";
import { chooseMany, chooseOne, nullChoice, objectChoice, orderingDecision, playerChoice, type Choice } from "./decisions";
import { damageObject, damagePlayer } from "./effects";
import { applySequentially, fail, givePriorityToActivePlayer, ok, type ApplyResult } from "./engine";
import type { GameEvent } from "./events";
import type { ObjectId, PlayerId } from "./ids";
import { openDecision } from "./prompts";
import type { AttackableTarget, GameState, Target } from "./state";
import { keysOf, withEntry } from "./util";

export interface CombatInProgress {
    rollback: GameState | null;
    attackers: Readonly<Record<ObjectId, CombatInfo>>;
    currentTargetDecision?: ObjectId | undefined;
    blocksChosen?: Readonly<Record<ObjectId, boolean>>;
}

export interface CombatInfo {
    id: ObjectId;
    attackableTargets?: AttackableTarget[] | undefined;
    attackTarget?: AttackableTarget;
    blockedBy?: readonly ObjectId[];
    blockOrder?: readonly number[];
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

export function cancelAttacks(state: GameState, player: PlayerId): ApplyResult {
    if (!state.combat || !state.combat.rollback) return fail("Unable to roll back to before attackers were chosen");
    return ok(state.combat.rollback, [{ type: "attacksCancelled", player }]);
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

export function beginDeclareBlockers(state: GameState): ApplyResult {
    if (state.turn.step !== "declareBlockers") return fail("Blockers can only be declared during the declare blockers step");
    if (!state.combat) return fail("No combat in progress to declare blockers for");
    if (!state.combat.attackers || Object.keys(state.combat.attackers).length === 0) return fail("No attackers have been declared this combat");
    const currentCombat = { ...state.combat };
    currentCombat.rollback = state;
    const playersBeingAttacked = getPlayersBeingAttacked(state);
    if (playersBeingAttacked.length === 0) return fail("No players are being attacked");
    if (playersBeingAttacked.length > 1) return fail("Attacking multiple opponents at once is not yet implemented");

    const blocker = playersBeingAttacked[0]!;
    const availableBlockers = getAllAvailableBlockers(state, blocker);
    if (availableBlockers.length === 0) return givePriorityToActivePlayer(state, []);
    currentCombat.blocksChosen = Object.fromEntries(availableBlockers.map((b) => [b, false]));

    return chooseBlockers({ ...state, combat: currentCombat }, blocker);
}

const SKIP_BLOCKS_ID = "SkipBlocks";

export function chooseBlockers(state: GameState, player: PlayerId): ApplyResult {
    if (state.turn.step !== "declareBlockers") return fail("Blockers can only be declared during the declare blockers step");
    if (!state.combat) return fail("No combat in progress to declare blockers for");
    if (!state.combat.attackers || Object.keys(state.combat.attackers).length === 0) return fail("No attackers have been declared this combat");
    if (!state.combat.blocksChosen || Object.keys(state.combat.blocksChosen).length === 0) return fail("No blockers available to choose");
    let currentBlocks = { ...state.combat.blocksChosen };
    let currentState = { ...state };
    const isFirstChoice = !Object.values(state.combat.blocksChosen).includes(true);
    for (const blocker of keysOf(state.combat.blocksChosen)) {
        if (!state.combat.blocksChosen[blocker]) {
            const blockOptions = getBlockableAttackers(state, blocker);
            if (blockOptions.length === 0) {
                currentBlocks = withEntry(currentBlocks, blocker, true);
                currentState = { ...state, combat: { ...state.combat, blocksChosen: currentBlocks } };
            } else {
                const options = [
                    ...blockOptions.map((attacker) => objectChoice(attacker, `Block ${getCardName(currentState, attacker)} (#${attacker})`)),
                    nullChoice(SKIP_BLOCKS_ID, "Don't block anything"),
                ];
                return ok(
                    openDecision(currentState, (id) =>
                        chooseOne({
                            id,
                            options,
                            player: player,
                            prompt: `Choose which attacker to block with ${getCardName(currentState, blocker, true)}`,
                            then: { kind: "selectBlockers", blocker },
                            onCancel: isFirstChoice ? undefined : { kind: "cancelBlocks" },
                        }),
                    ),
                    [],
                );
            }
        }
    }
    // All blocks have been chosen
    return declareBlocks(currentState, player);
}

export function applyChooseBlocksDecision(state: GameState, player: PlayerId, blocker: ObjectId, answer: readonly Choice[]): ApplyResult {
    if (state.turn.step !== "declareBlockers") return fail("Blockers can only be declared during the declare blockers step");
    if (!state.combat) return fail("No combat in progress to declare blockers for");
    if (!state.combat.attackers || Object.keys(state.combat.attackers).length === 0) return fail("No attackers have been declared this combat");
    if (!state.combat.blocksChosen || !(blocker in state.combat.blocksChosen)) return fail("No blockers available to choose");
    if (answer.length !== 1 || !answer[0]) return fail("Each creature can only block exactly one creature");
    const currentBlockers = { ...state.combat.blocksChosen };
    const currentAttackers = { ...state.combat.attackers };
    if (answer[0].value.kind === "object") {
        const attacker = answer[0].value.id;
        if (!(attacker in currentAttackers)) {
            return fail("Chose to block a nonexistant attacker");
        }
        if (currentAttackers[attacker]?.blockedBy) {
            currentAttackers[attacker].blockedBy = [...currentAttackers[attacker].blockedBy, blocker];
        } else {
            currentAttackers[attacker] = { ...currentAttackers[attacker], id: attacker, blockedBy: [blocker] };
        }
    }
    currentBlockers[blocker] = true;
    return chooseBlockers({ ...state, combat: { ...state.combat, attackers: currentAttackers, blocksChosen: currentBlockers } }, player);
}

export function declareBlocks(state: GameState, player: PlayerId): ApplyResult {
    if (state.turn.step !== "declareBlockers") return fail("Blockers can only be declared during the declare blockers step");
    if (!state.combat) return fail("No combat in progress to declare blockers for");
    if (!state.combat.attackers || Object.keys(state.combat.attackers).length === 0) return fail("No attackers have been declared this combat");
    if (!state.combat.blocksChosen || Object.values(state.combat.blocksChosen).includes(false)) return fail("Blocks have not yet been chosen");

    const events: GameEvent[] = [];
    for (const attacker of Object.values(state.combat.attackers)) {
        if (attacker.blockedBy) {
            events.push(
                ...attacker.blockedBy.map(
                    (blocker): GameEvent => ({
                        type: "blockDeclared",
                        player,
                        blocker,
                        blockerName: getCardName(state, blocker),
                        attacker: attacker.id,
                        attackerName: getCardName(state, attacker.id),
                    }),
                ),
            );
        }
    }
    return givePriorityToActivePlayer({ ...state, combat: { ...state.combat, rollback: null } }, events);
}

export function cancelBlocks(state: GameState, player: PlayerId): ApplyResult {
    if (!state.combat || !state.combat.rollback) return fail("Unable to roll back to before blockers were chosen");
    return ok(state.combat.rollback, [{ type: "blocksCancelled", player }]);
}

function getPlayersBeingAttacked(state: GameState): PlayerId[] {
    if (!state.combat?.attackers) return [];
    return [
        ...new Set(
            Object.values(state.combat.attackers).flatMap((a) => {
                if (a.attackTarget?.kind === "player") {
                    return a.attackTarget.id;
                } else if (a.attackTarget?.kind === "object") {
                    const obj = state.objects[a.attackTarget.id];
                    if (!obj) return [];
                    return obj.controller;
                } else {
                    return [];
                }
            }),
        ),
    ];
}

function getAllAvailableBlockers(state: GameState, player: PlayerId): ObjectId[] {
    const blockers: ObjectId[] = [];
    for (const objId of state.battlefield) {
        const obj = state.objects[objId];
        if (!obj) continue;
        if (obj.controller !== player) continue;
        if (!hasCardType(state, objId, "Creature")) continue;
        if (obj.tapped) continue;
        blockers.push(objId);
    }
    return blockers;
}

function getBlockableAttackers(state: GameState, blocker: ObjectId): ObjectId[] {
    if (!state.combat?.attackers) return [];
    return Object.values(state.combat.attackers).flatMap((a) => (canBlockThisAttacker(state, blocker, a) ? a.id : []));
}

function canBlockThisAttacker(state: GameState, blocker: ObjectId, attacker: CombatInfo): boolean {
    // Just sanity checks for now, will hook in restriction checks later
    const blockObj = state.objects[blocker];
    const attackObj = state.objects[attacker.id];
    if (!blockObj) return false;
    if (!attackObj) return false;
    if (blockObj.zone !== "battlefield" || attackObj.zone !== "battlefield") return false;
    if (blockObj.tapped) return false;
    if (!hasCardType(state, blocker, "Creature") || !hasCardType(state, attacker.id, "Creature")) return false;
    if (blockObj.controller === attackObj.controller) return false;
    return true;
}

//#endregion

//#region Combat Damage

export function startCombatDamage(state: GameState): ApplyResult {
    if (state.turn.step !== "combatDamage") return fail("Combat damage can only be dealt during the combat damage step");
    if (!state.combat) return fail("No combat in progress to process damage for");
    if (!state.combat.attackers || Object.keys(state.combat.attackers).length === 0) return fail("No attackers have been declared");
    for (const attacker of Object.values(state.combat.attackers)) {
        if ((attacker.blockedBy?.length ?? 0) > 1 && !attacker.blockOrder) {
            return ok(
                openDecision(state, (id) =>
                    orderingDecision({
                        id,
                        player: state.turn.activePlayer,
                        options: attacker.blockedBy!.map((blocker): Choice => objectChoice(blocker, getCardName(state, blocker, true))),
                        prompt: `Choose the order that ${getCardName(state, attacker.id, true)} will deal damage to its blockers`,
                        then: { kind: "selectDamageOrder", attacker: attacker.id },
                    }),
                ),
                [],
            );
        }
    }
    //TODO: Handle first strike
    return processCombatDamage(state, false);
}

export function applyDamageOrderingDecision(state: GameState, attacker: ObjectId, order: readonly number[]): ApplyResult {
    if (state.turn.step !== "combatDamage") return fail("Combat damage can only be dealt during the combat damage step");
    if (!state.combat) return fail("No combat in progress to process damage for");
    if (!state.combat.attackers || Object.keys(state.combat.attackers).length === 0) return fail("No attackers have been declared");
    if (!(attacker in state.combat.attackers) || state.combat.attackers[attacker]?.blockedBy?.length !== order.length) return fail("Invalid ordering for combat damage");
    return startCombatDamage({ ...state, combat: { ...state.combat, attackers: withEntry(state.combat.attackers, attacker, { ...state.combat.attackers[attacker], blockOrder: order }) } });
}

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
    if (obj.controller !== state.turn.activePlayer) return ok(state, []);
    const chars = getCharacteristics(state, combatInfo.id);
    if (!chars) return ok(state, []);
    if (!chars.power || chars.power <= 0) return ok(state, []);

    let damageLeft = chars.power;
    let currentState = { ...state };
    let events: GameEvent[] = [];
    const hasTrample = hasKeyword(currentState, combatInfo.id, "trample");
    if (combatInfo.blockedBy) {
        if (combatInfo.blockedBy.length === 1) {
            const blocker = combatInfo.blockedBy[0];
            let [result, newDamageLeft] = dealSingleCombatDamage(currentState, combatInfo.id, blocker, combatInfo.attackTarget, damageLeft, hasTrample, true);
            if (!result.ok) return result;
            currentState = result.state;
            events.push(...result.events);
            damageLeft = newDamageLeft;
        } else {
            if (combatInfo.blockedBy.length !== combatInfo.blockOrder?.length) return fail("Unable to determine order to deal combat damage in");
            for (let orderIndex = 0; orderIndex < combatInfo.blockOrder.length; orderIndex++) {
                const i = combatInfo.blockOrder[orderIndex]!;
                const blocker = combatInfo.blockedBy[i];
                let [result, newDamageLeft] = dealSingleCombatDamage(
                    currentState,
                    combatInfo.id,
                    blocker,
                    combatInfo.attackTarget,
                    damageLeft,
                    hasTrample,
                    orderIndex === combatInfo.blockOrder.length - 1,
                );
                if (!result.ok) return result;
                currentState = result.state;
                events.push(...result.events);
                damageLeft = newDamageLeft;
            }
        }
        if (!hasTrample) {
            return ok(currentState, events);
        }
    }

    const result =
        combatInfo.attackTarget.kind === "object"
            ? damageObject(currentState, combatInfo.attackTarget.id, combatInfo.id, damageLeft, true)
            : damagePlayer(currentState, combatInfo.attackTarget.id, combatInfo.id, damageLeft, true);
    return result.ok ? ok(result.state, [...events, ...result.events]) : result;
}

function dealSingleCombatDamage(
    state: GameState,
    attacker: ObjectId,
    blocker: ObjectId | undefined,
    attackTarget: AttackableTarget,
    attackerDamageLeft: number,
    hasTrample: boolean,
    isLastBlocker: boolean,
): [result: ApplyResult, damageLeft: number] {
    if (blocker && isStillValidBlocker(state, attacker, blocker, attackTarget)) {
        const blockerChars = getCharacteristics(state, blocker);
        if (blockerChars) {
            const blockerToughness = blockerChars?.toughness ?? 0;
            const damageToDeal = !hasTrample && isLastBlocker ? attackerDamageLeft : blockerToughness;
            const damageBlockerDeals = blockerChars.power ?? 0;
            const result = applySequentially(state, [(s) => damageObject(s, blocker, attacker, damageToDeal, true), (s) => damageObject(s, attacker, blocker, damageBlockerDeals, true)]);
            return [result, attackerDamageLeft - damageToDeal];
        }
    }
    return [ok(state, []), attackerDamageLeft];
}

function isStillValidBlocker(state: GameState, attacker: ObjectId, blocker: ObjectId, attackTarget: AttackableTarget): boolean {
    const obj = state.objects[blocker];
    if (!obj) return false;
    if (obj.zone !== "battlefield") return false;
    if (!hasCardType(state, blocker, "Creature")) return false;
    if (obj.controller !== (attackTarget.kind === "object" ? state.objects[attackTarget.id]?.controller : attackTarget.id)) return false;
    //TODO: Re-evaluate block restrictions before damage
    return true;
}

function isStillLegalTarget(state: GameState, attacker: ObjectId, target: AttackableTarget): boolean {
    //TODO: Re-evaluate target legality before damage
    return true;
}

//#endregion
