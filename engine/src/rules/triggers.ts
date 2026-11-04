import { isTrue, ok, type ApplyResult } from "../core/result";
import { snapshotSource } from "../model/characteristics";
import type { ChoiceValue } from "../model/decisions";
import type { GameEvent } from "../model/events";
import { isTriggerEvent, type TriggerEvent, type TriggerGameEvent } from "../model/predicates";
import type { Bindings, EvalScope, GameState, ObjectSnapshot, PendingTrigger, Target } from "../model/state";
import { evalCondition } from "./conditions";
import { evalEventPredicate } from "./predicates";


export function detectTriggers(state: GameState, events: readonly GameEvent[]): ApplyResult {
    const watchers = liveWatchers(state);
    const pendingTriggers: PendingTrigger[] = [];
    for (const event of events) {
        if (!isTriggerEvent(event)) continue;
       const candidates = [
        ...(watchers[event.type] ?? []).filter(w => !(event.type === "cardMoved" && event.after?.id === w.id)),
        ...moverWatchers(event)
       ];

       for (const watcher of candidates) {
            for (const ability of watcher.chars.abilities) {
                if (ability.kind !== "triggered") continue;
                if (!ability.triggerableZones.includes(watcher.zone)) continue;
                if (ability.trigger.event !== event.type) continue;
                const bindings = eventBindings(event);
                const scope: EvalScope = {
                    bindings,
                    source: watcher.id,
                    controller: watcher.controller,
                };
                if (!isTrue(evalEventPredicate(state, scope, event, ability.trigger.when))) continue;
                if (ability.trigger.interveningIf && !isTrue(evalCondition(state, scope, ability.trigger.interveningIf))) continue;
                pendingTriggers.push({ ability, controlller: watcher.controller, event, lki: watcher, bindings });
            }
        }
    }
    if (pendingTriggers.length === 0) return ok(state, events);
    return ok({...state, pendingTriggers: [...state.pendingTriggers, ...pendingTriggers]}, events, true);
}

function liveWatchers(state: GameState): Partial<Record<TriggerEvent, ObjectSnapshot[]>> {
    const watchers: Partial<Record<TriggerEvent, ObjectSnapshot[]>> = {};
    for (const obj of Object.values(state.objects)) {
        const snap = snapshotSource(state, obj.id);
        if (!snap) continue;
        for (const ability of snap.chars.abilities) {
            if (ability.kind !== "triggered") continue;
            if (!ability.triggerableZones.includes(obj.zone)) continue;
            (watchers[ability.trigger.event] ??= []).push(snap);
        }
    }
    return watchers;
}

function moverWatchers(event: TriggerGameEvent): ObjectSnapshot[] {
    if (event.type !== "cardMoved") return [];
    return [event.before, event.after].filter((s): s is ObjectSnapshot => s !== undefined);
}

// Eventually update event predicates to cover everything and change this type to TriggerGameEvent
function eventBindings(event: GameEvent): Bindings {
    switch (event.type) {
        case "stepStarted":
            return {
                "event.player": [{kind: "player", id: event.activePlayer}]
            };

        case "cardMoved":
            return {
                "event.object": [{ kind: "object", id: event.newId }],
                "event.player": [{ kind: "player", id: event.owner }],
            };

        case "lifeChanged":
            return {
                "event.player": [{ kind: "player", id: event.player }],
                "event.amount": event.delta,
            };

        case "landPlayed":
            return {
                "event.object": [{ kind: "object", id: event.card }],
            };

        case "manaAdded":
            return {
                "event.player": [{ kind: "player", id: event.player }],
            };

        case "cardDiscarded":
            return {
                "event.player": [{ kind: "player", id: event.player }],
                "event.card": [{ kind: "object", id: event.card }],
            };

        case "damageDealt":
            return {
                "event.amount": event.amount,
                "event.source": [{ kind: "object", id: event.source }],
                "event.target": [targetChoice(event.target)],
            };

        case "permanentTapped":
        case "permanentUntapped":
        case "permanentDestroyed":
        case "permanentSacrificed":
            return {
                "event.object": [{ kind: "object", id: event.object }],
            };

        case "spellCast":
            return {
                "event.player": [{ kind: "player", id: event.player }],
                "event.card": [{ kind: "object", id: event.card }],
            };

        case "abilityActivated":
            return {
                "event.player": [{ kind: "player", id: event.player }],
                "event.source": [{ kind: "object", id: event.abilitySourceLki.id }],
            };

        case "attackDeclared":
            return {
                "event.player": [{ kind: "player", id: event.player }],
                "event.attacker": [{ kind: "object", id: event.attackerLki.id }],
                "event.target": [targetChoice(event.target)],
            };

        case "blockDeclared":
            return {
                "event.player": [{ kind: "player", id: event.player }],
                "event.attacker": [{ kind: "object", id: event.attackerLki.id }],
                "event.blocker": [{ kind: "object", id: event.blockerLki.id }],
            };

        default:
            return {};
    }
}

function targetChoice(target: Target): ChoiceValue {
    switch (target.kind) {
        case "object":
            return { kind: "object", id: target.id };
        case "player":
            return { kind: "player", id: target.id };
        case "stackEntry":
            return { kind: "stackEntry", id: target.id };
    }
}