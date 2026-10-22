import { getCharacteristics } from "./characteristics";
import { fail, ok, type ApplyResult } from "./engine";
import type { ObjectId, PlayerId } from "./ids";
import type { GameState } from "./state";
import { withEntry } from "./util";

export function damagePlayer(state: GameState, player: PlayerId, source: ObjectId, amount: number, isCombatDamage: boolean): ApplyResult {
    const p = state.players[player];
    if (!p) return fail("Invalid player to damage");
    return ok({ ...state, players: withEntry(state.players, player, { ...p, life: p.life - amount }) }, [
        { type: "damageDealt", source, amount, target: { kind: "player", id: player }, isCombatDamage },
    ]);
}

export function damageObject(state: GameState, target: ObjectId, source: ObjectId, amount: number, isCombatDamage: boolean): ApplyResult {
    const obj = state.objects[target];
    if (!obj) return fail("Damage target no longer exists");
    if (obj.zone !== "battlefield") return fail("Target is no longer on the battlefield");
    const chars = getCharacteristics(state, target);
    if (!chars) return fail("Unable to determine target characteristics");
    if (chars.types.includes("Creature")) return damageCreature(state, target, source, amount, isCombatDamage);
    else if (chars.types.includes("Planeswalker")) return damagePlaneswalker(state, target, source, amount, isCombatDamage);
    return ok(state, []);
}

function damageCreature(state: GameState, target: ObjectId, source: ObjectId, amount: number, isCombatDamage: boolean): ApplyResult {
    const obj = state.objects[target];
    if (!obj) return fail("Damage target no longer exists");
    return ok({ ...state, objects: withEntry(state.objects, target, { ...obj, damage: obj.damage + amount }) }, [
        { type: "damageDealt", source, amount, target: { kind: "object", id: target }, isCombatDamage },
    ]);
}

function damagePlaneswalker(state: GameState, target: ObjectId, source: ObjectId, amount: number, isCombatDamage: boolean): ApplyResult {
    const obj = state.objects[target];
    if (!obj) return fail("Damage target no longer exists");
    if (!("loyalty" in obj.counters)) return fail("Planeswalkers have to have loyalty counters defined");
    return ok({ ...state, objects: withEntry(state.objects, target, { ...obj, counters: withEntry(obj.counters, "loyalty", obj.counters["loyalty"] - amount) }) }, [
        { type: "damageDealt", source, amount, target: { kind: "object", id: target }, isCombatDamage },
    ]);
}
