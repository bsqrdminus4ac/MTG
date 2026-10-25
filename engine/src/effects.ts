import type { Ability, Effect, EffectTarget, PlayerRef } from "./cards";
import { getCardName, getCharacteristics } from "./characteristics";
import { applySequentially, fail, ok, type ApplyResult } from "./engine";
import type { GameEvent } from "./events";
import type { ObjectId, PlayerId } from "./ids";
import { stepFromApply, type EffectContext, type StepResult } from "./resolution";
import type { GameState, StackEntry, Target } from "./state";
import { assertNever, withEntry } from "./util";

export function resolvePlayers(state: GameState, ctx: EffectContext, ref: PlayerRef): PlayerId[] {
    if (ref === "controller") return [ctx.controller];
    if (ref === "opponent") return Object.keys(state.players).filter((p) => p !== ctx.controller) as PlayerId[];
    return Object.keys(state.players) as PlayerId[];
}

export function resolveStackEntryEffects(state: GameState, entry: StackEntry): readonly Effect[] {
    const chars = getCharacteristics(state, entry.source);
    if (!chars?.abilities) return [];
    let ability: Ability | undefined;
    if (entry.kind === "spell") {
        if (entry.spellIndex) {
            ability = chars.abilities[entry.spellIndex];
            if (ability?.kind !== "spell") return [];
        } else {
            ability = chars.abilities.find((a) => a.kind === "spell");
        }
    } else {
        ability = chars.abilities[entry.abilityIndex];
        if (ability?.kind !== "activated" && ability?.kind !== "triggered") return [];
    }
    return ability?.effects ?? [];
}

function resolveEffectTargets(state: GameState, ctx: EffectContext, t: EffectTarget): readonly Target[] {
    switch (t.kind) {
        case "target": {
            const target = ctx.targets[t.index];
            return target && ctx.legalTargets[t.index] ? [target] : []; // illegal target: the effect does nothing
        }
        case "self":
            return [{ kind: "object", id: ctx.source }];
        case "player":
            return resolvePlayers(state, ctx, t.who).map((id) => ({ kind: "player", id }));
        default:
            return assertNever(t);
    }
}

export function executeEffect(state: GameState, ctx: EffectContext, effect: Effect): StepResult {
    let currentState = state;
    switch (effect.kind) {
        case "damage": {
            const result = applySequentially(
                currentState,
                resolveEffectTargets(state, ctx, effect.to).map((target): ((s: GameState) => ApplyResult) => {
                    if (target.kind === "player") return (s) => damagePlayer(s, target.id, ctx.source, effect.amount, false);
                    if (target.kind === "object") return (s) => damageObject(s, target.id, ctx.source, effect.amount, false);
                    return (s) => fail("Damage cannot be dealt to spells/abilities on the stack");
                }),
            );
            return stepFromApply(result);
        }
        default:
            return fail(`Resolving effects of kind ${effect.kind} is not implemented yet`) as StepResult;
    }
}

//#region Primitive effects

export function damagePlayer(state: GameState, player: PlayerId, source: ObjectId, amount: number, isCombatDamage: boolean): ApplyResult {
    const p = state.players[player];
    if (!p) return fail("Invalid player to damage");
    return ok({ ...state, players: withEntry(state.players, player, { ...p, life: p.life - amount }) }, [
        { type: "damageDealt", source, sourceName: getCardName(state, source), amount, target: { kind: "player", id: player }, targetName: "", isCombatDamage },
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
        { type: "damageDealt", source, sourceName: getCardName(state, source), amount, target: { kind: "object", id: target }, targetName: getCardName(state, target), isCombatDamage },
    ]);
}

function damagePlaneswalker(state: GameState, target: ObjectId, source: ObjectId, amount: number, isCombatDamage: boolean): ApplyResult {
    const obj = state.objects[target];
    if (!obj) return fail("Damage target no longer exists");
    if (!("loyalty" in obj.counters)) return fail("Planeswalkers have to have loyalty counters defined");
    return ok({ ...state, objects: withEntry(state.objects, target, { ...obj, counters: withEntry(obj.counters, "loyalty", obj.counters["loyalty"] - amount) }) }, [
        { type: "damageDealt", source, sourceName: getCardName(state, source), amount, target: { kind: "object", id: target }, targetName: getCardName(state, target), isCombatDamage },
    ]);
}

//#endregion
