import { type ApplyResult, fail, ok } from "../core/result";
import { withEntry } from "../core/util";
import { getCardName, getCharacteristics, hasKeyword } from "../model/characteristics";
import type { GameEvent } from "../model/events";
import type { ObjectId, PlayerId } from "../model/ids";
import { type ManaType, addMana } from "../model/mana";
import type { GameState } from "../model/state";
import { moveObject } from "../model/zones";


export function tapPermanent(state: GameState, objId: ObjectId): ApplyResult {
    const obj = state.objects[objId];
    if (!obj) return fail(`Unable to find object #${objId}`);
    if (obj.tapped) return fail("That object is already tapped");
    const tappedObj = withEntry(state.objects, objId, { ...obj, tapped: true });
    return ok({ ...state, objects: tappedObj }, [{ type: "permanentTapped", object: objId, cardName: getCardName(state, objId) }]);
}

export function damagePlayer(state: GameState, player: PlayerId, source: ObjectId, amount: number, isCombatDamage: boolean): ApplyResult {
    const p = state.players[player];
    if (!p) return fail("Invalid player to damage");
    if (amount === 0) return ok(state, []);
    return ok({ ...state, players: withEntry(state.players, player, { ...p, life: p.life - amount }) }, [
        { type: "damageDealt", source, sourceName: getCardName(state, source), amount, target: { kind: "player", id: player }, targetName: "", isCombatDamage },
    ]);
}

export function gainLife(state: GameState, player: PlayerId, amount: number): ApplyResult {
    const p = state.players[player];
    if (!p) return fail("Invalid player to gain life");
    if (amount <= 0) return ok(state, []);
    return ok({ ...state, players: withEntry(state.players, player, { ...p, life: p.life + amount }) }, [{ type: "lifeChanged", player, delta: amount }]);
}

export function loseLife(state: GameState, player: PlayerId, amount: number): ApplyResult {
    const p = state.players[player];
    if (!p) return fail("Invalid player to lose life");
    if (amount <= 0) return ok(state, []);
    return ok({ ...state, players: withEntry(state.players, player, { ...p, life: p.life - amount }) }, [{ type: "lifeChanged", player, delta: -amount }]);
}

export function addManaEffect(state: GameState, player: PlayerId, mana: ManaType, amount: number): ApplyResult {
    const p = state.players[player];
    if (!p) return fail("Invalid player to lose life");
    if (amount <= 0) return ok(state, []);
    return ok({ ...state, players: withEntry(state.players, player, addMana(p, mana, amount)) }, [{ type: "manaAdded", player, mana, amount }]);
}

export function discardCard(state: GameState, player: PlayerId, card: ObjectId, cause?: string): ApplyResult {
    if (!state.players[player]?.hand.includes(card)) return fail("Card to discard was not in that player's hand");
    const cardName = getCardName(state, card);
    const moveResult = moveObject(state, card, "graveyard");
    if (!moveResult) return fail("Unable to move card from hand to graveyard");
    const discardEvent: GameEvent = cause ? { type: "cardDiscarded", player, card, cardName, cause } : { type: "cardDiscarded", player, card, cardName };
    return ok(moveResult.state, [discardEvent, ...moveResult.events]);
}

export function damageObject(state: GameState, target: ObjectId, source: ObjectId, amount: number, isCombatDamage: boolean): ApplyResult {
    const obj = state.objects[target];
    if (!obj) return ok(state, []);
    if (obj.zone !== "battlefield") return ok(state, []);
    const chars = getCharacteristics(state, target);
    if (!chars) return fail("Unable to determine target characteristics");
    if (chars.types.includes("Creature")) return damageCreature(state, target, source, amount, isCombatDamage);
    else if (chars.types.includes("Planeswalker")) return damagePlaneswalker(state, target, source, amount, isCombatDamage);
    return ok(state, []);
}

export function damageCreature(state: GameState, target: ObjectId, source: ObjectId, amount: number, isCombatDamage: boolean): ApplyResult {
    const obj = state.objects[target];
    if (!obj) return ok(state, []);
    if (amount === 0) return ok(state, []);
    return ok({ ...state, objects: withEntry(state.objects, target, { ...obj, damage: obj.damage + amount }) }, [
        { type: "damageDealt", source, sourceName: getCardName(state, source), amount, target: { kind: "object", id: target }, targetName: getCardName(state, target), isCombatDamage },
    ]);
}

export function damagePlaneswalker(state: GameState, target: ObjectId, source: ObjectId, amount: number, isCombatDamage: boolean): ApplyResult {
    const obj = state.objects[target];
    if (!obj) return ok(state, []);
    if (amount === 0) return ok(state, []);
    if (!("loyalty" in obj.counters)) return fail("Planeswalkers have to have loyalty counters defined");
    return ok({ ...state, objects: withEntry(state.objects, target, { ...obj, counters: withEntry(obj.counters, "loyalty", obj.counters["loyalty"] - amount) }) }, [
        { type: "damageDealt", source, sourceName: getCardName(state, source), amount, target: { kind: "object", id: target }, targetName: getCardName(state, target), isCombatDamage },
    ]);
}

export function destroyPermanent(state: GameState, target: ObjectId, source: ObjectId): ApplyResult {
    const obj = state.objects[target];
    if (!obj) return ok(state, []);
    if (obj.zone !== "battlefield") return ok(state, []);
    if (hasKeyword(state, target, "indestructible")) return ok(state, []); // Consider adding "effect prevented" event
    const targetName = getCardName(state, target);
    const result = moveObject(state, target, "graveyard");
    if (!result) return ok(state, []);
    const event: GameEvent = { type: "permanentDestroyed", object: target, cardName: targetName, source };
    return ok(result.state, [event, ...result.events]);
}