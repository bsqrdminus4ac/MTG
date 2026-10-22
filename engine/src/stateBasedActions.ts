import { getCharacteristics } from "./characteristics";
import { applySequentially, fail, ok, type ApplyResult } from "./engine";
import type { GameEvent } from "./events";
import type { ObjectId } from "./ids";
import type { GameState } from "./state";
import { withEntry } from "./util";
import { moveObject } from "./zones";


export function checkStateBasedActions(state: GameState, eventsSoFar: GameEvent[]): ApplyResult {
    const nextState = applySequentially(state, 
        [
            checkFor0Life, checkDrawFromEmptyLibrary, checkPoison, 
            clearTokens, checkFor0Toughness, checkForLethalDamage,
            checkFor0Loyalty, combinePlusMinusCounters,
            checkForWinner
        ]
    );
    if (!nextState.ok) return nextState;
    
    if (nextState.changesMade && !nextState.state.winner) {
        eventsSoFar.push(...nextState.events);
        return checkStateBasedActions(nextState.state, eventsSoFar);
    }
    return ok(nextState.state, [...eventsSoFar, ...nextState.events ]);
}

function checkForWinner(state: GameState): ApplyResult {
    let stillActive = [];
    for (const p of Object.values(state.players)) {
        if (!p.hasLostTheGame) stillActive.push(p.id);
    }
    if (stillActive.length === 0) { return fail("No active players remain"); }
    if (stillActive.length === 1) { return ok({...state, winner: stillActive[0]!}, [{type:"wonTheGame", player: stillActive[0]!}]); }
    return ok(state, []);
}

function checkFor0Life(state: GameState): ApplyResult {
    let currentState = state;
    const events: GameEvent[] = [];
    for (const p of Object.values(state.players)) {
        if (p.hasLostTheGame) continue;
        if (p.life <= 0) {
            currentState = {...currentState, players: withEntry(currentState.players, p.id, {...p, hasLostTheGame: true})};
            events.push({type: "lostTheGame", player: p.id, cause: "having 0 or less life"});
        }
    }
    return ok(currentState, events, events.length > 0);
}

function checkDrawFromEmptyLibrary(state: GameState): ApplyResult {
    let currentState = state;
    const events: GameEvent[] = [];
    for (const p of Object.values(state.players)) {
        if (p.hasLostTheGame) continue;
        if (p.drewFromEmptyLibrary) {
            currentState = {...currentState, players: withEntry(currentState.players, p.id, {...p, hasLostTheGame: true})};
            events.push({type: "lostTheGame", player: p.id, cause: "drawing from an empty library"});
        }
    }
    return ok(currentState, events, events.length > 0);
}

function checkPoison(state: GameState): ApplyResult {
    let currentState = state;
    const events: GameEvent[] = [];
    for (const p of Object.values(state.players)) {
        if (p.hasLostTheGame) continue;
        if (p.counters["poison"] ?? 0 >= 10) {
            currentState = {...currentState, players: withEntry(currentState.players, p.id, {...p, hasLostTheGame: true})};
            events.push({type: "lostTheGame", player: p.id, cause: "having 10 or more poison counters"});
        }
    }
    return ok(currentState, events, events.length > 0);
}

function clearTokens(state: GameState): ApplyResult {
    let currentState = state;
    const events: GameEvent[] = [];
    const idsToRemove: ObjectId[] = [];
    for (const obj of Object.values(state.objects)) {
        const def = state.definitions[obj.definitionId];
        if (!def) return fail(`Unable to locate definition of object #${obj.id}`);
        if (def.isToken && obj.zone !== "battlefield") {
            idsToRemove.push(obj.id);
        }
    }
    const updatedObjects = {...state.objects};
    for (const id of idsToRemove) delete updatedObjects[id];
    return ok({...currentState, objects: updatedObjects}, events, idsToRemove.length > 0);
}

//TODO: Spell copying

function checkFor0Toughness(state: GameState): ApplyResult {
    let currentState = state;
    const events: GameEvent[] = [];
    const idsToMove: ObjectId[] = [];
    for (const obj of Object.values(state.objects)) {
        const chars = getCharacteristics(state, obj.id);
        if (obj.zone !== "battlefield") continue;
        if (!chars) return fail(`Unable to locate characteristics of object #${obj.id}`);
        if (chars.types.includes("Creature") && (chars.toughness ?? 0) <= 0) {
            idsToMove.push(obj.id);
        }
    }
    for (const id of idsToMove) {
        const result = moveObject(currentState, id, "graveyard");
        if (!result) return fail(`Unable to move object #${id} to the graveyard`);
        currentState = result.state;
        events.push(...result.events);
    }
    return ok(currentState, events, idsToMove.length > 0);
}

function checkForLethalDamage(state: GameState): ApplyResult {
    let currentState = state;
    const events: GameEvent[] = [];
    const idsToMove: ObjectId[] = [];
    for (const obj of Object.values(state.objects)) {
        const chars = getCharacteristics(state, obj.id);
        if (obj.zone !== "battlefield") continue;
        if (!chars) return fail(`Unable to locate characteristics of object #${obj.id}`);
        if (chars.types.includes("Creature") && (obj.damage >= (chars.toughness ?? 0))) {
            idsToMove.push(obj.id);
        }
    }
    for (const id of idsToMove) {
        const result = moveObject(currentState, id, "graveyard");
        if (!result) return fail(`Unable to move object #${id} to the graveyard`);
        currentState = result.state;
        events.push(...result.events);
    }
    return ok(currentState, events, idsToMove.length > 0);
}

//TODO: Deathtouch

function checkFor0Loyalty(state: GameState): ApplyResult {
    let currentState = state;
    const events: GameEvent[] = [];
    const idsToMove: ObjectId[] = [];
    for (const obj of Object.values(state.objects)) {
        const chars = getCharacteristics(state, obj.id);
        if (obj.zone !== "battlefield") continue;
        if (!chars) return fail(`Unable to locate characteristics of object #${obj.id}`);
        if (chars.types.includes("Planeswalker") && ((obj.counters["loyalty"] ?? 0) <= 0)) {
            idsToMove.push(obj.id);
        }
    }
    for (const id of idsToMove) {
        const result = moveObject(currentState, id, "graveyard");
        if (!result) return fail(`Unable to move object #${id} to the graveyard`);
        currentState = result.state;
        events.push(...result.events);
    }
    return ok(currentState, events, idsToMove.length > 0);
}

//TODO: Legendary rule

//TODO: Aura legality

//TODO: Equipment legality

function combinePlusMinusCounters(state: GameState): ApplyResult {
    let updatedObjects = {...state.objects};
    let changesMade: boolean = false;
    for (const obj of Object.values(state.objects)) {
        if (obj.zone !== "battlefield") continue;
        if (obj.counters["+1/+1"] && obj.counters["-1/-1"] && obj.counters["+1/+1"] > 0 && obj.counters["-1/-1"] > 0) {
            const toRemove = Math.min(obj.counters["+1/+1"], obj.counters["-1/-1"]);
            let counters: Readonly<Record<string, number>> = withEntry(obj.counters, "+1/+1", obj.counters["+1/+1"] - toRemove);
            counters = withEntry(obj.counters, "-1/-1", obj.counters["-1/-1"] - toRemove);
            updatedObjects = withEntry(updatedObjects, obj.id, {...obj, counters});
            changesMade = true;
        }
    }
    return ok({...state, objects: updatedObjects}, [], changesMade);
}

//TODO: Sagas
