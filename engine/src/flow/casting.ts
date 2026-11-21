import { badResult, fail, goodResult, ok, type ApplyResult, type Result } from "../core/result";
import { assertNever, withEntry } from "../core/util";
import { getCardName, getCharacteristics, snapshotObject } from "../model/characteristics";
import { costHasChoice } from "../model/costs";
import { abilityChoice, chooseMany, chooseOne, objectChoice, yesNo, type Choice } from "../model/decisions";
import { abilityText } from "../model/effects";
import type { GameEvent } from "../model/events";
import { type ObjectId, type PlayerId } from "../model/ids";
import { canPayMana, costStr } from "../model/mana";
import type { CastingInProgress, EvalScope, GameState, Target } from "../model/state";
import { moveObject } from "../model/zones";
import { calculateFinalCost, getAbilityCost, payCosts } from "../rules/costs";
import { openDecision } from "../rules/pending";
import { getAbilityForSpell, pushStackEntry, type NewStackEntry } from "../rules/stack";
import { buildTargetOptions, buildTargetPrompt, getLegalTargets } from "../rules/targeting";
import { buildDemands, checkCastable, couldPayFinalCost, safePicks } from "./castability";
import { activateManaAbility, getAllManaSources } from "./manaAbilities";
import { grantPriority } from "./priority";

//#region Cast begins

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

    const moveResult = moveObject(state, card, "stack");
    if (!moveResult) return fail("Unable to move the spell to the stack");

    let castingState: GameState = {
        ...moveResult.state,
        casting: {
            player,
            card: moveResult.newId,
            originalCard: card,
            kind: spell.kind,
            ability: spell,
            targets: [],
            targetSpecsSelected: targetSpecs,
            cost: null,
            bindings: {},
            costChoices: [],
            costChoicesSelected: [],
            rollback,
            events: moveResult.events,
        },
    };
    return continueCasting(castingState, [{ type: "spellCastStart", player, card: moveResult.newId, cardName: spellInfo.name }]);
}

export function continueCasting(state: GameState, events: readonly GameEvent[]): ApplyResult {
    if (!state.casting) return fail("No cast in progress");
    if (state.casting.targetSpecsSelected.length === 0) {
        // No targets, skip to optional cost selection step
        return chooseOptionalCosts(state, events);
    } else {
        return selectTargetOptions(state, events);
    }
}

//#endregion

//#region Select Targets

export function selectTargetOptions(state: GameState, events: readonly GameEvent[]): ApplyResult {
    if (!state.casting) return fail("No casting in progress to cancel");
    if (state.casting.targetSpecsSelected.length === 0) return fail("Entered target selection with no target specification for the selected spell");
    const casting = state.casting;
    const player = casting.player;
    const card = casting.card;
    const nextSpecIndex = casting.targetSpecsSelected.indexOf(false);
    if (nextSpecIndex === -1) {
        let bindings = casting.bindings;
        for (const [i, targets] of state.casting.targets.entries()) {
            bindings = withEntry(bindings, `target.${i}`, targets); // Inject targets as "target.#" bindings for costs and effects to refer to
        }
        // Targets have all been selected, go to optional cost selection step
        return chooseOptionalCosts({ ...state, casting: { ...casting, bindings } }, events);
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

    return ok(nextState, events);
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
    return selectTargetOptions(nextState, []);
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

//#endregion

//#region Decide on optional costs and lock total cost

function chooseOptionalCosts(state: GameState, events: readonly GameEvent[]): ApplyResult {
    if (!state.casting) return fail("No casting in progress to cancel");
    let casting = { ...state.casting };
    if (!casting.optionalCostChoices) {
        const allCosts = getAbilityCost(state, state.casting.card, state.casting.ability);
        if (!allCosts) {
            // No costs to cast, continue to next step, skipping locking of costs
            return payManaOptions(state, events);
        }
        casting.optionalCostChoices = allCosts.filter((c) => c.kind === "optional");
    }
    const nextOptional = casting.optionalCostChoices[0];
    if (!nextOptional) {
        // All choices made, continue to next step
        delete casting["optionalCostChoices"];
        return lockTotalCost({ ...state, casting }, events);
    }

    const nextState = { ...state, casting };

    const scope: EvalScope = {
        bindings: withEntry(casting.bindings, nextOptional.bindAs, true), // Check whether the final cost could be paid if this option was chosen
        controller: casting.player,
        source: casting.card,
    };
    const finalCost = calculateFinalCost(nextState, scope, casting.ability);
    // Need to include the final cost in casting temporarily so that the mana payment forecasting that calls into payManaOptions doesn't error
    if (!couldPayFinalCost({ ...nextState, casting: { ...casting, cost: finalCost } }, scope, finalCost, [])) {
        return applyOptionalCostDecision(nextState, nextOptional.bindAs, false); // If we wouldn't be able to pay for this optional cost, bind it as false and move onto the next one
    }

    const decisionState = openDecision(nextState, (id) =>
        yesNo({
            id: id,
            player: casting.player,
            prompt: nextOptional.prompt,
            then: { kind: "chooseOptionalCosts", bindAs: nextOptional.bindAs },
        }),
    );
    return ok(decisionState, events);
}

export function applyOptionalCostDecision(state: GameState, bindAs: string, answer: boolean): ApplyResult {
    if (!state.casting) return fail("No casting in progress to cancel");
    if (!state.casting.optionalCostChoices) return fail("No optional costs are being chosen for this cast");
    let choices = [...state.casting.optionalCostChoices];
    const currentChoice = choices[0];
    if (!currentChoice) return fail("No optional costs are left to choose for this cast");
    choices = answer ? [...currentChoice.cost.filter((c) => c.kind === "optional"), ...choices.slice(1)] : choices.slice(1); // If there are any nested optional costs (unlikely), append them to the start so they get chosen next
    const nextState = { ...state, casting: { ...state.casting, bindings: withEntry(state.casting.bindings, bindAs, answer), optionalCostChoices: choices } };
    return chooseOptionalCosts(nextState, []);
}

function lockTotalCost(state: GameState, events: readonly GameEvent[]): ApplyResult {
    if (!state.casting) return fail("No casting in progress to cancel");
    if (state.casting.optionalCostChoices) return fail("There are still optional costs that have yet to be decided on");
    const scope: EvalScope = {
        bindings: state.casting.bindings,
        controller: state.casting.player,
        source: state.casting.card,
    };
    const finalCost = calculateFinalCost(state, scope, state.casting.ability);
    return makeCostChoices({ ...state, casting: { ...state.casting, cost: finalCost } }, events); // Lock in final cost, then move on to cost choices
}

//#endregion

//#region Cost choices

function makeCostChoices(state: GameState, events: readonly GameEvent[]): ApplyResult {
    if (!state.casting) return fail("No casting in progress to cancel");
    let casting = { ...state.casting };
    if (!casting.cost) return fail("Casting cost has not been locked in yet");
    if (casting.cost.components.length === 0) {
        return payManaOptions(state, events); // If no costs need decisions, move on to mana payment
    }

    const player = casting.player;
    const card = casting.card;
    if (casting.costChoicesSelected.length === 0) {
        casting.costChoicesSelected = new Array(casting.cost.components.length).fill(false);
    }
    let nextState: GameState = { ...state, casting };
    const nextChoiceIndex = casting.costChoicesSelected.indexOf(false);
    if (nextChoiceIndex === -1) {
        return payManaOptions(state, events); // Finished selecting cost choices, move on to mana payment
    }

    const nextChoice = casting.cost?.components[nextChoiceIndex];
    if (!nextChoice) return fail("Invalid cost to make selections for");
    const castName = getCastName(nextState, casting);
    const scope = {
        controller: player,
        source: card,
        bindings: casting.bindings,
    };
    if (nextChoice.kind === "discard") {
        const demands = buildDemands(nextState, scope, "discard", casting.cost.components, casting.costChoices);
        const legalChoices = safePicks(demands, nextChoiceIndex);
        if (legalChoices.length < nextChoice.amount) return fail("Ended up with an illegal cost choice selection");
        nextState = openDecision(nextState, (id) =>
            chooseMany({
                id,
                min: nextChoice.amount,
                max: nextChoice.amount,
                player,
                prompt: `Choose ${nextChoice.amount} cards to discard to pay for ${castName}`,
                options: legalChoices.map((o) => objectChoice(o, getCardName(nextState, o, true))),
                then: nextChoice.bindAs ? { kind: "selectCostChoices", bindAs: nextChoice.bindAs } : { kind: "selectCostChoices" },
                onCancel: { kind: "cancelAbility" },
            }),
        );
        return ok(nextState, events);
    } else if (nextChoice.kind === "sacrifice") {
        const demands = buildDemands(nextState, scope, "sacrifice", casting.cost.components, casting.costChoices);
        const legalChoices = safePicks(demands, nextChoiceIndex);
        if (legalChoices.length < nextChoice.amount) return fail("Ended up with an illegal cost choice selection");
        nextState = openDecision(nextState, (id) =>
            chooseMany({
                id,
                min: nextChoice.amount,
                max: nextChoice.amount,
                player,
                prompt: `Choose ${nextChoice.amount} permanents to sacrifice to pay for ${castName}`,
                options: legalChoices.map((o) => objectChoice(o, getCardName(nextState, o, true))),
                then: nextChoice.bindAs ? { kind: "selectCostChoices", bindAs: nextChoice.bindAs } : { kind: "selectCostChoices" },
                onCancel: { kind: "cancelAbility" },
            }),
        );
        return ok(nextState, events);
    } else {
        return applyCostChoiceDecision(nextState, undefined, []); // If the cost doesn't require a decision, push [] into the cost choices
    }
}

export function applyCostChoiceDecision(state: GameState, bindAs: string | undefined, selection: readonly Choice[]): ApplyResult {
    if (!state.casting) return fail("No casting in progress to cancel");
    if (!state.casting.cost) return fail("Casting cost has not been locked in yet");
    if (state.casting.costChoicesSelected.length === 0) return fail("No cost choices need to be made for this cast");
    const nextChoiceIndex = state.casting.costChoicesSelected.indexOf(false);
    const newSelected = [...state.casting.costChoicesSelected.slice(0, nextChoiceIndex), true, ...state.casting.costChoicesSelected.slice(nextChoiceIndex + 1)];
    const newChoices = selection.flatMap((s) => (s.value.kind === "object" ? s.value.id : []));
    const newBindings =
        bindAs && selection.length > 0
            ? withEntry(
                  state.casting.bindings,
                  bindAs,
                  selection.map((s) => s.value),
              )
            : state.casting.bindings;
    const nextState: GameState = { ...state, casting: { ...state.casting, costChoices: [...state.casting.costChoices, newChoices], costChoicesSelected: newSelected, bindings: newBindings } };
    return makeCostChoices(nextState, []);
}

//#endregion

//#region Pay mana

export function payManaOptions(state: GameState, events: readonly GameEvent[]): ApplyResult {
    if (!state.casting) return fail("No casting in progress to pay for");
    const casting = state.casting;
    if (!casting.cost) return fail("Casting cost has not been locked in yet");
    const player = casting.player;
    const card = casting.card;
    const castName = getCastName(state, casting);
    if (!casting.cost?.mana) {
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
            return ok(decisionState, events); // Null mana costs on activated abilities are fine, just skip this step
        }
    }

    const p = state.players[player];
    if (!p) return fail("Invalid player");
    let prompt = "";
    if (casting.kind === "spell") {
        prompt = `Pay ${costStr(casting.cost.mana)} to cast ${castName}?`;
    } else {
        prompt = `Pay ${costStr(casting.cost.mana)} to activate ${castName}?`;
    }
    if (canPayMana(p.manaPool, casting.cost.mana)) {
        const decisionState = openDecision(state, (id) =>
            yesNo({
                id: id,
                player: player,
                prompt,
                then: { kind: "costPayment" },
            }),
        );
        return ok(decisionState, events);
    }

    const chosen = new Set(casting.costChoices.flat());
    const manaAbilities = getAllManaSources(state, player, card).filter((s) => !(chosen.has(s.source) && s.ability.cost.some((c) => c.kind === "sacrificeSelf"))); // If a mana source would sacrifice itself as part of its mana ability and that source is already being sacrificed as part of another cost, exclude it from the list
    if (manaAbilities.length === 0) return fail("Not enough mana abilities left to pay for this spell");
    const options = manaAbilities.map((ability) => abilityChoice(ability.source, ability.ref, getCardName(state, ability.source)));

    prompt =
        casting.kind === "spell" ? `Add mana to cast ${castName}?\n(total cost is ${costStr(casting.cost.mana)})` : `Add mana to activate ${castName}? (total cost is ${costStr(casting.cost.mana)})`;

    const decisionState = openDecision(state, (id) =>
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

export function applyAddManaDecision(state: GameState, answer: readonly Choice[]): ApplyResult {
    if (!state.casting) return fail("No spell is currently being cast");
    if (answer.length !== 1) return fail("Can only select one mana ability to use at a time");
    const choice = answer[0]!;
    if (choice.value.kind !== "ability") return fail("Adding mana while casting has to be via an ability");
    const activatedResult = activateManaAbility(state, state.casting.player, choice.value.id, choice.value.ref);
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
    return payManaOptions(nextState, []);
}

//#endregion

//#region Cast commit or cancel

export function applyCommitSpellDecision(state: GameState, answer: boolean): ApplyResult {
    if (answer) {
        return commitCast(state);
    } else {
        return cancelCast(state);
    }
}

export function cancelCast(state: GameState): ApplyResult {
    if (!state.casting) return fail("No casting in progress to cancel");
    const event: GameEvent =
        state.casting.kind === "spell"
            ? {
                  type: "spellCastCancelled",
                  player: state.casting.player,
                  card: state.casting.originalCard,
                  cardName: getCardName(state.casting.rollback, state.casting.originalCard),
              }
            : {
                  type: "abilityActivateCancelled",
                  player: state.casting.player,
                  abilitySource: state.casting.sourceSnapshot.id,
                  description: abilityText(state.casting.ability, state.casting.sourceSnapshot.chars.name),
                  sourceName: state.casting.sourceSnapshot.chars.name,
              };
    return ok(state.casting.rollback, [event]);
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
            entry = {
                controller: castingInfo.player,
                kind: castingInfo.kind,
                ability: castingInfo.ability,
                source: castingInfo.card,
                targets: castingInfo.targets,
                bindings: castingInfo.bindings,
            };
            const spellLki = snapshotObject(currentState, castingInfo.card);
            if (!spellLki) return fail("Unable to snapshot spell on the stack");
            out.push({
                type: "spellCast",
                card: castingInfo.card,
                player: castingInfo.player,
                targets: castingInfo.targets.flat(), //TODO: Consider making event layered too
                spellLki: spellLki,
            });
            const stackState = pushStackEntry(currentState, entry);
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
                description: abilityText(entry.ability, entry.sourceSnapshot.chars.name),
            });
            const stackState = pushStackEntry(currentState, entry);
            return grantPriority({ ...stackState, casting: null }, out, castingInfo.player, 0);
        }
        default:
            return assertNever(castingInfo);
    }
}

export function payCastingCost(state: GameState, casting: CastingInProgress): ApplyResult {
    if (!casting.cost) return ok(state, []);
    const snapshot = casting.kind === "spell" ? snapshotObject(state, casting.card) : casting.sourceSnapshot;
    if (!snapshot) return fail("Unable to locate spell");
    const validationResult = validateCostChoices(state, casting);
    if (!validationResult.ok) return fail("Casting cost validation failed: " + validationResult.error);
    return payCosts(state, casting.player, snapshot, casting.ability, casting.cost, casting.costChoices);
}

function validateCostChoices(state: GameState, casting: CastingInProgress): Result<null> {
    if (!casting.cost) return badResult("Invalid cost to validate");
    for (const [i, c] of casting.cost.components.entries()) {
        if (!costHasChoice(c.kind)) continue;
        if (c.kind === "sacrifice") {
            if (c.amount !== casting.costChoices[i]?.length) return badResult(`Cost #${i} (sacrifice) did not have the correct number of choices`);
            if (
                casting.costChoices[i].some((o) => {
                    const obj = state.objects[o];
                    if (!obj) return true;
                    if (obj.controller !== casting.player) return true;
                    if (obj.zone !== "battlefield") return true;
                    return false;
                })
            )
                return badResult(`Cost #${i} had at least one permanent selected that was no longer sacrificable`);
        } else if (c.kind === "discard") {
            if (c.amount !== casting.costChoices[i]?.length) return badResult(`Cost #${i} (discard) did not have the correct number of choices`);
            if (casting.costChoices[i].some((o) => !state.players[casting.player]?.hand.includes(o))) return badResult(`Cost #${i} had at least one card selected that was no longer in hand`);
        }
    }
    return goodResult(null);
}

//#endregion

//#region Helpers

function getCastName(state: GameState, casting: CastingInProgress): string {
    if (casting.kind === "spell") return `spell ${getCardName(state, casting.card, true)}`;
    else if (casting.kind === "activated") return `${casting.sourceSnapshot.chars.name}'s ability`;
    return assertNever(casting);
}

//#endregion
