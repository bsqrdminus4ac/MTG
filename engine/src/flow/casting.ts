import { fail, ok, type ApplyResult } from "../core/result";
import { withEntry } from "../core/util";
import { getCardName, getCharacteristics, isPermanentType } from "../model/characteristics";
import { chooseMany, chooseOne, manaAbilityChoice, objectChoice, playerChoice, yesNo, type Choice } from "../model/decisions";
import { getCardText, type TargetSpec } from "../model/effects";
import type { GameEvent } from "../model/events";
import { nextID, type ObjectId, type PlayerId, type StackId } from "../model/ids";
import { canPayMana, payMana, type ManaCost } from "../model/mana";
import type { EvalScope, GameState, SpellOnStack, Target } from "../model/state";
import { moveObject } from "../model/zones";
import { openDecision } from "../rules/pending";
import { getLegalTargets } from "../rules/targeting";
import { activateAbility } from "./abilities";
import { getAllManaSources } from "./manaAbilities";
import { withPriorityDecision } from "./priority";

export function beginCast(state: GameState, player: PlayerId, card: ObjectId): ApplyResult {
    const rollback = state;
    const spellInfo = getCharacteristics(state, card);
    if (!spellInfo) return fail(`Unable to get characteristics of #${card}`);
    let targetSpecs: boolean[] = [];
    if (!spellInfo.types.some((t) => isPermanentType(t))) {
        const spellAbilities = spellInfo.abilities;
        const spell = spellAbilities?.find((a) => a.kind === "spell");
        if (!spell) return fail("This card has no spell abilities to cast");
        targetSpecs = new Array(spell.targets.length).fill(false);
    }
    let currentState: GameState = {
        ...state,
        casting: {
            player,
            card,
            targets: [],
            targetSpecsSelected: targetSpecs,
            cost: null,
            bindings: {},
            rollback,
            events: [{ type: "spellCastStart", player, card, cardName: spellInfo.name }],
        },
    };
    if (targetSpecs.length === 0) {
        // No targets, skip to mana payment step
        return payManaOptions(currentState);
    } else {
        return selectTargetOptions(currentState);
    }
}

export function cancelCast(state: GameState): ApplyResult {
    if (!state.casting) return fail("No casting in progress to cancel");
    return ok(state.casting.rollback, [
        ...state.casting.events,
        {
            type: "spellCastCancelled",
            player: state.casting.player,
            card: state.casting.card,
            cardName: getCardName(state, state.casting.card),
        },
    ]);
}

export function commitCast(state: GameState): ApplyResult {
    const castingInfo = state.casting;
    if (!castingInfo) return fail("No spell is being cast");

    const p = state.players[castingInfo.player];
    if (!p) return fail("Invalid player");
    let currentState = state;
    if (castingInfo.cost) {
        const playerPaid = payMana(p, castingInfo.cost);
        if (!playerPaid) return fail("Unable to pay for the spell");
        currentState = {
            ...currentState,
            players: withEntry(state.players, castingInfo.player, playerPaid),
        };
    }

    const [stackState, stackID] = nextID<StackId>(currentState);
    currentState = stackState;
    const moved = moveObject(currentState, castingInfo.card, "stack");
    if (!moved) return fail("Unable to move spell to the stack");
    currentState = moved.state;
    const spell: SpellOnStack = {
        controller: castingInfo.player,
        id: stackID,
        kind: "spell",
        source: moved.newId,
        targets: castingInfo.targets,
        bindings: {},
    };
    const spellEvent: GameEvent = {
        type: "spellCastSuccess",
        card: moved.newId,
        player: castingInfo.player,
        targets: castingInfo.targets.flat(), //TODO: Consider making event layered too
        cardName: getCardName(currentState, moved.newId),
    };
    const addedToStack = [...currentState.stack, spell];
    const allEvents = [...castingInfo.events, ...moved.events, spellEvent];
    currentState = { ...currentState, stack: addedToStack, casting: null };
    return ok(withPriorityDecision(currentState), allEvents);
}

export function selectTargetOptions(state: GameState): ApplyResult {
    if (!state.casting) return fail("No casting in progress to cancel");
    if (state.casting.targetSpecsSelected.length === 0) return fail("Entered target selection with no target specification for the selected spell");
    const player = state.casting.player;
    const card = state.casting.card;
    const nextSpecIndex = state.casting.targetSpecsSelected.indexOf(false);
    if (nextSpecIndex === -1) {
        // Targets have all been selected, go to mana payment step
        return payManaOptions(state);
    }
    const chars = getCharacteristics(state, card);
    const spellAbilities = chars?.abilities;
    const spell = spellAbilities?.find((a) => a.kind === "spell");
    if (!spell) return fail("This card has no spell abilities to cast");
    const nextSpec = spell.targets[nextSpecIndex];
    if (!nextSpec) return fail("Invalid TargetSpec to select targets for");
    const scope: EvalScope = {
        controller: player,
        source: card,
        bindings: {},
    };
    const legalTargetsResult = getLegalTargets(state, scope, nextSpec);
    if (!legalTargetsResult.ok) return fail(legalTargetsResult.error);
    const legalTargets = legalTargetsResult.value;

    const options: Choice[] = [];
    for (const target of legalTargets) {
        if (target.kind === "player") {
            options.push(playerChoice(target.id, `Target player ${target.id} with ${chars?.name}`));
        } else if (target.kind === "object") {
            const targetChars = getCharacteristics(state, target.id);
            if (!targetChars) continue;
            options.push(objectChoice(target.id, `Target object ${targetChars.name} (#${target.id}) with ${chars?.name}`));
        }
    }
    const nextState = openDecision(state, (id) =>
        chooseMany({
            id,
            options: options,
            prompt: buildTargetPrompt(card, chars?.name!, nextSpec),
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

function buildTargetPrompt(card: ObjectId, cardName: string, spec: TargetSpec): string {
    let prompt = "Select ";
    const targetDesc = spec.description ?? "";
    if (spec.minCount === 1 && spec.maxCount === 1) {
        prompt += `the ${targetDesc} target `;
    } else if (spec.minCount === spec.maxCount) {
        prompt += `${spec.minCount} ${targetDesc} targets `;
    } else {
        prompt += `between ${spec.minCount} and ${spec.maxCount} ${targetDesc} targets `;
    }
    prompt += `for spell ${cardName} (#${card})`;
    return prompt;
}

// No real logic for now, could add logic around target decisions changing costs later
function calculateFinalCost(state: GameState, player: PlayerId, card: ObjectId): ManaCost | null {
    if (!state?.casting) return null;
    const obj = getCharacteristics(state, card);
    if (!obj) return null;
    return obj.manaCost;
}

export function payManaOptions(state: GameState): ApplyResult {
    if (!state.casting) return fail("No casting in progress to pay for");
    const casting = state.casting;
    const player = casting.player;
    const card = casting.card;
    const cost = casting.cost ?? calculateFinalCost(state, player, card);
    if (!cost) return fail("Invalid mana cost for spell");
    const nextState: GameState = casting.cost === cost ? state : { ...state, casting: { ...casting, cost } };

    const p = nextState.players[player];
    if (!p) return fail("Invalid player");
    const cardName = getCharacteristics(nextState, card)?.name;
    if (canPayMana(p.manaPool, cost)) {
        const decisionState = openDecision(nextState, (id) =>
            yesNo({
                id: id,
                player: player,
                prompt: `Pay mana to cast ${cardName}?`,
                then: { kind: "costPayment" },
            }),
        );
        return ok(decisionState, []);
    }

    const manaAbilities = getAllManaSources(nextState, player);
    if (manaAbilities.length === 0) return fail("Not enough mana abilities left to pay for this spell");
    const options = manaAbilities.map((ability) =>
        manaAbilityChoice(
            ability.source,
            ability.abilityIndex,
            getCardText(ability.ability.effects)[0] ?? `Ability #${ability.abilityIndex + 1} of ${getCharacteristics(nextState, ability.source)?.name}`,
        ),
    );
    const decisionState = openDecision(nextState, (id) =>
        chooseOne({
            id,
            options,
            player,
            prompt: `Add mana to cast ${cardName}`,
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
    const activatedResult = activateAbility(state, state.casting.player, choice.value.id, choice.value.index);
    if (!activatedResult.ok) return activatedResult;
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
