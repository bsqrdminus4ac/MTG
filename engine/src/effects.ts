import { hasKeyword, type Ability, type Effect, type EffectTarget, type PlayerRef } from "./cards";
import { getCardName, getCharacteristics } from "./characteristics";
import { applySequentially, fail, ok, type ApplyResult } from "./engine";
import type { GameEvent } from "./events";
import type { ObjectId, PlayerId } from "./ids";
import { addMana, type ManaType } from "./mana";
import { stepFromApply, type EffectContext, type StepResult } from "./resolution";
import { getRemainingPlayersInTurnOrder, type GameState, type StackEntry, type Target } from "./state";
import { assertNever, withEntry } from "./util";
import { drawCardResult, moveObject } from "./zones";

export function resolvePlayers(state: GameState, ctx: EffectContext, ref: PlayerRef): PlayerId[] {
    if (ref === "controller") return [ctx.controller];
    if (ref === "opponent") return getRemainingPlayersInTurnOrder(state).filter((p) => p !== ctx.controller) as PlayerId[];
    return getRemainingPlayersInTurnOrder(state) as PlayerId[];
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
            return stepFromApply(
                applySequentially(
                    currentState,
                    resolveEffectTargets(state, ctx, effect.to).map((target): ((s: GameState) => ApplyResult) => {
                        if (target.kind === "player") return (s) => damagePlayer(s, target.id, ctx.source, effect.amount, false);
                        if (target.kind === "object") return (s) => damageObject(s, target.id, ctx.source, effect.amount, false);
                        return () => fail("Damage cannot be dealt to spells/abilities on the stack");
                    }),
                ),
            );
        }
        case "draw":
            return stepFromApply(
                applySequentially(
                    currentState,
                    resolveEffectTargets(state, ctx, { kind: "player", who: effect.who }).flatMap((target) => {
                        if (target.kind !== "player") return () => fail("Only players can draw cards");
                        return Array.from({ length: effect.count }, () => (s) => drawCardResult(s, target.id));
                    }),
                ),
            );
        case "gainLife":
            return stepFromApply(
                applySequentially(
                    currentState,
                    resolveEffectTargets(state, ctx, { kind: "player", who: effect.who }).map((target) => {
                        if (target.kind !== "player") return () => fail("Only players can gain life");
                        return (s) => gainLife(s, target.id, effect.amount);
                    }),
                ),
            );
        case "loseLife":
            return stepFromApply(
                applySequentially(
                    currentState,
                    resolveEffectTargets(state, ctx, { kind: "player", who: effect.who }).map((target) => {
                        if (target.kind !== "player") return () => fail("Only players can lose life");
                        return (s) => loseLife(s, target.id, effect.amount);
                    }),
                ),
            );
        case "destroy":
            return stepFromApply(
                applySequentially(
                    currentState,
                    resolveEffectTargets(state, ctx, effect.target).map((target) => {
                        if (target.kind === "object") return (s) => destroyPermanent(s, target.id, ctx.source);
                        return () => fail("Destroying non-permanents has not been implemented yet");
                    }),
                ),
            );
        case "addMana":
            return stepFromApply(addManaEffect(currentState, ctx.controller, effect.mana, effect.amount));
        default:
            return fail(`Resolving effects of kind ${effect.kind} is not implemented yet`) as StepResult;
    }
}

//#region Primitive effects

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

function damageCreature(state: GameState, target: ObjectId, source: ObjectId, amount: number, isCombatDamage: boolean): ApplyResult {
    const obj = state.objects[target];
    if (!obj) return ok(state, []);
    if (amount === 0) return ok(state, []);
    return ok({ ...state, objects: withEntry(state.objects, target, { ...obj, damage: obj.damage + amount }) }, [
        { type: "damageDealt", source, sourceName: getCardName(state, source), amount, target: { kind: "object", id: target }, targetName: getCardName(state, target), isCombatDamage },
    ]);
}

function damagePlaneswalker(state: GameState, target: ObjectId, source: ObjectId, amount: number, isCombatDamage: boolean): ApplyResult {
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

//#endregion
