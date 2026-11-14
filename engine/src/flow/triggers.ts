import { fail, ok, type ApplyResult } from "../core/result";
import { chooseMany, orderingDecision, triggerChoice, type Choice } from "../model/decisions";
import { abilityText } from "../model/effects";
import type { GameEvent } from "../model/events";
import type { PlayerId } from "../model/ids";
import { getRemainingPlayersInTurnOrder, type EvalScope, type GameState, type PendingTrigger, type Target } from "../model/state";
import { openDecision } from "../rules/pending";
import { pushTriggerEntry } from "../rules/stack";
import { buildTargetOptions, buildTargetPrompt, getLegalTargets } from "../rules/targeting";
import { describeTrigger } from "../rules/triggers";
import { givePriorityToActivePlayer } from "./priority";

export function placePendingTriggers(state: GameState, events: readonly GameEvent[]): ApplyResult {
    let currentState: GameState = { ...state, placingTriggers: null };
    if (Object.keys(currentState.pendingTriggers).length === 0) {
        return currentState.pending ? givePriorityToActivePlayer({ ...currentState, pending: null }, events) : ok(currentState, events);
    }
    const playerOrder = getRemainingPlayersInTurnOrder(currentState);
    for (const player of playerOrder) {
        const triggersToPlace = currentState.pendingTriggers[player];
        if (!triggersToPlace || triggersToPlace.length === 0) continue;
        if (triggersToPlace.length === 1) {
            const trigger = triggersToPlace[0];
            if (!trigger) continue;
            const remainingPendingTriggers = { ...currentState.pendingTriggers };
            delete remainingPendingTriggers[player];
            currentState = {
                ...currentState,
                pendingTriggers: remainingPendingTriggers,
                placingTriggers: { queue: [trigger] },
            };
            return selectTargetOptions(currentState, events);
        } else {
            return ok(
                openDecision(currentState, (id) =>
                    orderingDecision({
                        id,
                        options: triggersToPlace.map((trigger) => triggerChoice(trigger.id, trigger.lki.id, describeTrigger(currentState, trigger))),
                        player,
                        prompt: "Choose the order that the triggers should go on the stack (first one added resolves last)",
                        then: { kind: "orderTriggers", player },
                    }),
                ),
                events,
            );
        }
    }
    return givePriorityToActivePlayer(currentState, events);
}

export function applyTriggerOrderingDecision(state: GameState, player: PlayerId, order: readonly number[]): ApplyResult {
    if (state.placingTriggers) return fail("Another player is still making trigger targeting decisions");
    const triggersToPlace = state.pendingTriggers[player];
    if (!triggersToPlace || triggersToPlace.length < 2) return fail("Trigger ordering requires at least 2 triggers to order");
    if (triggersToPlace.length !== order.length) return fail("Ordering size doesn't match number of triggers to order");
    const movedTriggers = { ...state.pendingTriggers };
    delete movedTriggers[player];
    const next: GameState = { ...state, pendingTriggers: movedTriggers, placingTriggers: { queue: order.map((i) => triggersToPlace[i] as PendingTrigger) } };
    return selectTargetOptions(next, []);
}

export function selectTargetOptions(state: GameState, events: readonly GameEvent[]): ApplyResult {
    let currentState = state;
    if (!currentState.placingTriggers) return fail("No triggers are being placed");
    let currentTriggerInfo = currentState.placingTriggers.currentTrigger;
    if (!currentTriggerInfo) {
        const [nextTrigger, ...remainingTriggers] = currentState.placingTriggers.queue;
        currentState = { ...currentState, placingTriggers: { queue: remainingTriggers } };
        if (!nextTrigger) return placePendingTriggers(currentState, events); // Move on to the next player's pending triggers
        currentTriggerInfo = { targets: [], targetSpecsSelected: new Array(nextTrigger.ability.targets.length).fill(false), trigger: nextTrigger };
        currentState = { ...currentState, placingTriggers: { ...currentState.placingTriggers!, currentTrigger: currentTriggerInfo } };
    }
    const nextSpecIndex = currentTriggerInfo.targetSpecsSelected.indexOf(false);
    const triggerDesc = describeTrigger(currentState, currentTriggerInfo.trigger);

    if (nextSpecIndex === -1) {
        currentState = { ...currentState, placingTriggers: { queue: currentState.placingTriggers!.queue } }; // Remove currentTrigger from placingTriggers
        currentState = pushTriggerEntry(currentState, {
            kind: "ability",
            ability: currentTriggerInfo.trigger.ability,
            bindings: currentTriggerInfo.trigger.bindings,
            controller: currentTriggerInfo.trigger.controlller,
            source: currentTriggerInfo.trigger.lki.id,
            sourceSnapshot: currentTriggerInfo.trigger.lki,
            targets: currentTriggerInfo.targets,
        });
        const triggerEvent: GameEvent = {
            type: "abilityTriggered",
            player: currentTriggerInfo.trigger.controlller,
            abilitySourceLki: currentTriggerInfo.trigger.lki,
            description: abilityText(currentTriggerInfo.trigger.ability, currentTriggerInfo.trigger.lki.chars.name),
            targets: currentTriggerInfo.targets.flat(),
        };
        return selectTargetOptions(currentState, [...events, triggerEvent]); // Move on to next trigger in placingTriggers queue
    } else {
        const nextSpec = currentTriggerInfo.trigger.ability.targets[nextSpecIndex];
        if (!nextSpec) return fail("Invalid TargetSpec to select targets for");
        const scope: EvalScope = {
            controller: currentTriggerInfo.trigger.controlller,
            bindings: currentTriggerInfo.trigger.bindings,
            source: currentTriggerInfo.trigger.lki.id, // Might need to adjust this, since the trigger source might not exist any more
        };
        const legalTargetsResult = getLegalTargets(currentState, scope, nextSpec);
        if (!legalTargetsResult.ok) return fail(legalTargetsResult.error);

        if (legalTargetsResult.value.length === 0) {
            if (nextSpec.minCount > 0) {
                // No legal targets, drop trigger without adding it to stack
                // Current code means that if spec 1 has a valid target but spec 2 doesn't,
                // the player will have to choose the first target before the trigger gets dropped. Probably fine for now.
                currentState = { ...currentState, placingTriggers: { queue: currentState.placingTriggers!.queue } }; // Remove currentTrigger from placingTriggers
                return selectTargetOptions(currentState, events); // Move on to next trigger in placingTriggers queue
            } else {
                // If no targets is valid, save an empty target list for this spec and move on to the next one
                return applyTriggerTargetSelections(currentState, []);
            }
        }

        const options = buildTargetOptions(currentState, `${currentTriggerInfo.trigger.lki.chars.name}'s ability`, legalTargetsResult.value);
        const nextState = openDecision(currentState, (id) =>
            chooseMany({
                id,
                options: options,
                prompt: buildTargetPrompt(triggerDesc, nextSpec),
                min: nextSpec.minCount,
                max: nextSpec.maxCount,
                player: currentTriggerInfo.trigger.controlller,
                then: { kind: "selectTriggerTargets" },
            }),
        );
        return ok(nextState, events);
    }
}

export function applyTriggerTargetingDecision(state: GameState, answer: readonly Choice[]): ApplyResult {
    const targetsToAdd: Target[] = [];
    for (const choice of answer) {
        if (choice.value.kind !== "player" && choice.value.kind !== "object" && choice.value.kind !== "stackEntry") return fail("Invalid choice type for spell targeting");
        targetsToAdd.push(choice.value); // Don't need to revalidate target legality since state can't change between selectTargetOptions and now.
    }
    return applyTriggerTargetSelections(state, targetsToAdd);
}

function applyTriggerTargetSelections(state: GameState, targets: Target[]): ApplyResult {
    if (!state.placingTriggers || !state.placingTriggers.currentTrigger) return fail("No triggers are being placed");
    if (state.placingTriggers.currentTrigger.targetSpecsSelected.length === 0) return fail("Selected targets with no target specification defined for the selected trigger");
    const currentTrigger = state.placingTriggers.currentTrigger;
    const selectedSpecIndex = currentTrigger.targetSpecsSelected.indexOf(false);
    const newSpecs = [...currentTrigger.targetSpecsSelected.slice(0, selectedSpecIndex), true, ...currentTrigger.targetSpecsSelected.slice(selectedSpecIndex + 1)];
    const nextState: GameState = {
        ...state,
        placingTriggers: {
            ...state.placingTriggers,
            currentTrigger: {
                ...currentTrigger,
                targetSpecsSelected: newSpecs,
                targets: [...currentTrigger.targets, targets],
            },
        },
    };
    return selectTargetOptions(nextState, []);
}
