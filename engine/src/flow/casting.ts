import { fail, ok, type ApplyResult } from "../core/result";
import { assertNever } from "../core/util";
import { getCardName, getCharacteristics, snapshotSource } from "../model/characteristics";
import { abilityChoice, chooseMany, chooseOne, yesNo, type Choice } from "../model/decisions";
import { describeAbility, getCardText } from "../model/effects";
import type { GameEvent } from "../model/events";
import { type ObjectId, type PlayerId } from "../model/ids";
import { canPayMana } from "../model/mana";
import type { CastingInProgress, EvalScope, GameState, Target } from "../model/state";
import { moveObject } from "../model/zones";
import { calculateFinalCost, payAbilityCosts, paySpellCosts } from "../rules/costs";
import { openDecision } from "../rules/pending";
import { getAbilityForSpell, pushStackEntry, type NewStackEntry } from "../rules/stack";
import { buildTargetOptions, buildTargetPrompt, getLegalTargets } from "../rules/targeting";
import { checkCastable } from "./castability";
import { activateManaAbility, getAllManaSources } from "./manaAbilities";
import { grantPriority } from "./priority";

export function beginSpellCast(state: GameState, player: PlayerId, card: ObjectId): ApplyResult {
    const castable = checkCastable(state, player, card);
    if (!castable.ok) return castable;

    const rollback = state;
    const spellInfo = getCharacteristics(state, card);
    if (!spellInfo) return fail(`Unable to get characteristics of #${card}`);
    let targetSpecs: boolean[] = [];
    const spell = getAbilityForSpell(spellInfo);
    if (!spell) return fail("This card has no spell abilities to cast");
    targetSpecs = new Array(spell.targets.length).fill(false);

    let castingState: GameState = {
        ...state,
        casting: {
            player,
            card,
            kind: spell.kind,
            ability: spell,
            targets: [],
            targetSpecsSelected: targetSpecs,
            cost: null,
            bindings: {},
            rollback,
            events: [{ type: "spellCastStart", player, card, cardName: spellInfo.name }],
        },
    };
    return continueCasting(castingState);
}

export function continueCasting(state: GameState): ApplyResult {
    if (!state.casting) return fail("No cast in progress");
    if (state.casting.targetSpecsSelected.length === 0) {
        // No targets, skip to mana payment step
        return payManaOptions(state);
    } else {
        return selectTargetOptions(state);
    }
}

export function cancelCast(state: GameState): ApplyResult {
    if (!state.casting) return fail("No casting in progress to cancel");
    const event: GameEvent =
        state.casting.kind === "spell"
            ? {
                  type: "spellCastCancelled",
                  player: state.casting.player,
                  card: state.casting.card,
                  cardName: getCardName(state, state.casting.card),
              }
            : {
                  type: "abilityActivateCancelled",
                  player: state.casting.player,
                  abilitySource: state.casting.sourceSnapshot.id,
                  description: describeAbility(state.casting.ability, state.casting.sourceSnapshot.chars.name, true),
                  sourceName: state.casting.sourceSnapshot.chars.name,
              };
    return ok(state.casting.rollback, [...state.casting.events, event]);
}

export function commitCast(state: GameState): ApplyResult {
    const castingInfo = state.casting;
    if (!castingInfo) return fail("No spell is being cast");

    const p = state.players[castingInfo.player];
    if (!p) return fail("Invalid player");

    let currentState = state;
    const out: GameEvent[] = [];
    out.push(...castingInfo.events);

    const playerPaid = payCastingCost(currentState, castingInfo);
    if (!playerPaid.ok) return playerPaid;
    currentState = playerPaid.state;
    out.push(...playerPaid.events);

    let entry: NewStackEntry | null = null;
    switch (castingInfo.kind) {
        case "spell": {
            const moved = moveObject(currentState, castingInfo.card, "stack");
            if (!moved) return fail("Unable to move spell to the stack");
            out.push(...moved.events);
            entry = {
                controller: castingInfo.player,
                kind: castingInfo.kind,
                ability: castingInfo.ability,
                source: moved.newId,
                targets: castingInfo.targets,
                bindings: castingInfo.bindings,
            };
            const spellLki = snapshotSource(moved.state, moved.newId);
            if (!spellLki) return fail("Unable to snapshot spell on the stack");
            out.push({
                type: "spellCast",
                card: moved.newId,
                player: castingInfo.player,
                targets: castingInfo.targets.flat(), //TODO: Consider making event layered too
                spellLki: spellLki,
            });
            const stackState = pushStackEntry(moved.state, entry);
            return grantPriority({ ...stackState, casting: null }, out, castingInfo.player, 0);
        }
        case "activated": {
            entry = {
                controller: castingInfo.player,
                kind: "ability",
                ability: castingInfo.ability,
                source: castingInfo.sourceSnapshot.id,
                targets: castingInfo.targets,
                bindings: castingInfo.bindings,
                sourceSnapshot: castingInfo.sourceSnapshot,
            };
            out.push({
                type: "abilityActivated",
                abilitySourceLki: entry.sourceSnapshot,
                player: castingInfo.player,
                targets: castingInfo.targets.flat(), //TODO: Consider making event layered too
                description: describeAbility(entry.ability, entry.sourceSnapshot.chars.name, true),
            });
            const stackState = pushStackEntry(currentState, entry);
            return grantPriority({ ...stackState, casting: null }, out, castingInfo.player, 0);
        }
        default:
            return assertNever(castingInfo);
    }
}

export function payCastingCost(state: GameState, casting: CastingInProgress): ApplyResult {
    if (casting.kind === "spell") {
        return casting.cost ? paySpellCosts(state, casting.player, casting.card, casting.ability, casting.cost) : fail("Spells require a mana cost to cast, even if the cost is 0");
    } else if (casting.kind === "activated") {
        return payAbilityCosts(state, casting.player, casting.sourceSnapshot, casting.ability);
    }
    return assertNever(casting);
}

export function selectTargetOptions(state: GameState): ApplyResult {
    if (!state.casting) return fail("No casting in progress to cancel");
    if (state.casting.targetSpecsSelected.length === 0) return fail("Entered target selection with no target specification for the selected spell");
    const casting = state.casting;
    const player = casting.player;
    const card = casting.card;
    const nextSpecIndex = casting.targetSpecsSelected.indexOf(false);
    if (nextSpecIndex === -1) {
        // Targets have all been selected, go to mana payment step
        return payManaOptions(state);
    }

    const nextSpec = casting.ability.targets[nextSpecIndex];
    if (!nextSpec) return fail("Invalid TargetSpec to select targets for");
    const scope: EvalScope = {
        controller: player,
        source: card,
        bindings: {},
    };
    const legalTargetsResult = getLegalTargets(state, scope, nextSpec);
    if (!legalTargetsResult.ok) return fail(legalTargetsResult.error);

    const targetCastName = getCastName(state, state.casting);
    const options = buildTargetOptions(state, targetCastName, legalTargetsResult.value);

    const nextState = openDecision(state, (id) =>
        chooseMany({
            id,
            options: options,
            prompt: buildTargetPrompt(targetCastName, nextSpec),
            min: nextSpec.minCount,
            max: nextSpec.maxCount,
            player: player,
            then: { kind: "selectAbilityTargets" },
            onCancel: { kind: "cancelAbility" },
        }),
    );

    return ok(nextState, []);
}

export function applyTargetSelections(state: GameState, targets: Target[]): ApplyResult {
    if (!state.casting) return fail("No casting in progress to set targets for");
    if (state.casting.targetSpecsSelected.length === 0) return fail("Selected targets with no target specification defined for the selected spell");
    const casting = state.casting;
    const selectedSpecIndex = casting.targetSpecsSelected.indexOf(false);
    const newSpecs = [...casting.targetSpecsSelected.slice(0, selectedSpecIndex), true, ...casting.targetSpecsSelected.slice(selectedSpecIndex + 1)];
    const nextState: GameState = {
        ...state,
        casting: {
            ...casting,
            targetSpecsSelected: newSpecs,
            targets: [...casting.targets, targets],
        },
    };
    return selectTargetOptions(nextState);
}

export function payManaOptions(state: GameState): ApplyResult {
    if (!state.casting) return fail("No casting in progress to pay for");
    const casting = state.casting;
    const player = casting.player;
    const card = casting.card;
    const chars = getCharacteristics(state, casting.card);
    const cost = casting.cost ?? calculateFinalCost(state, player, chars, casting.ability);
    const castName = getCastName(state, casting);
    if (!cost) {
        if (casting.kind === "spell") return fail("Invalid mana cost for spell");
        else {
            const decisionState = openDecision(state, (id) =>
                yesNo({
                    id,
                    player,
                    prompt: `Activate ${castName}?`,
                    then: { kind: "costPayment" },
                }),
            );
            return ok(decisionState, []); // Null mana costs on activated abilities are fine, just skip this step
        }
    }
    const nextState: GameState = casting.cost === cost ? state : { ...state, casting: { ...casting, cost } };

    const p = nextState.players[player];
    if (!p) return fail("Invalid player");
    let prompt = "";
    if (casting.kind === "spell") {
        prompt = `Pay mana to cast ${castName}?`;
    } else {
        prompt = `Pay mana to activate ${castName}?`;
    }
    if (canPayMana(p.manaPool, cost)) {
        const decisionState = openDecision(nextState, (id) =>
            yesNo({
                id: id,
                player: player,
                prompt,
                then: { kind: "costPayment" },
            }),
        );
        return ok(decisionState, []);
    }

    const manaAbilities = getAllManaSources(nextState, player, card);
    if (manaAbilities.length === 0) return fail("Not enough mana abilities left to pay for this spell");
    const options = manaAbilities.map((ability) =>
        abilityChoice(
            ability.source,
            ability.abilityIndex,
            getCardText(ability.ability.effects)[0] ?? `Ability #${ability.abilityIndex + 1} of ${getCharacteristics(nextState, ability.source)?.name}`,
        ),
    );

    prompt = casting.kind === "spell" ? `Add mana to cast ${castName}?` : `Add mana to activate ${castName}?`;

    const decisionState = openDecision(nextState, (id) =>
        chooseOne({
            id,
            options,
            player,
            prompt,
            then: { kind: "costPayment" },
            onCancel: { kind: "cancelAbility" },
        }),
    );
    return ok(decisionState, []);
}

export function applyTargetingDecision(state: GameState, answer: readonly Choice[]): ApplyResult {
    if (!state.casting) return fail("No spell is currently being cast");
    const targetsToAdd: Target[] = [];
    for (const choice of answer) {
        if (choice.value.kind !== "player" && choice.value.kind !== "object" && choice.value.kind !== "stackEntry") return fail("Invalid choice type for spell targeting");
        targetsToAdd.push(choice.value); // Don't need to revalidate target legality since state can't change between selectTargetOptions and now.
    }
    return applyTargetSelections(state, targetsToAdd);
}

export function applyAddManaDecision(state: GameState, answer: readonly Choice[]): ApplyResult {
    if (!state.casting) return fail("No spell is currently being cast");
    if (answer.length !== 1) return fail("Can only select one mana ability to use at a time");
    const choice = answer[0]!;
    if (choice.value.kind !== "ability") return fail("Adding mana while casting has to be via an ability");
    const activatedResult = activateManaAbility(state, state.casting.player, choice.value.id, choice.value.index);
    if (!activatedResult.ok) return activatedResult;
    if (activatedResult.waiting) return activatedResult; // waiting for a decision; return as is
    const casting = activatedResult.state.casting;
    if (!casting) return fail("No spell is currently being cast");
    const nextState: GameState = {
        ...activatedResult.state,
        casting: {
            ...casting,
            events: [...casting.events, ...activatedResult.events],
        },
    };
    return payManaOptions(nextState);
}

export function applyCommitSpellDecision(state: GameState, answer: boolean): ApplyResult {
    if (answer) {
        return commitCast(state);
    } else {
        return cancelCast(state);
    }
}

function getCastName(state: GameState, casting: CastingInProgress): string {
    if (casting.kind === "spell") return `spell ${getCardName(state, casting.card, true)}`;
    else if (casting.kind === "activated") return `${casting.sourceSnapshot.chars.name}'s ability`;
    return assertNever(casting);
}