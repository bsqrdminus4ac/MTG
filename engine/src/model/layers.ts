import { isTrue } from "../core/result";
import { assertNever } from "../core/util";
import type { Ability, AbilityRef, GrantOrigin } from "./abilities";
import type { Characteristics } from "./cardDefinition";
import { LAYER_OF, LAYER_ORDER, type Layer, type Modification, type ObjectMatch } from "./continuous";
import type { Brand, EffectId, ObjectId, PlayerId, Timestamp } from "./ids";
import { evalObjectPredicate } from "./objectPredicates";
import { getAllObjectsInZone, type EvalScope, type GameState, type ObjectSnapshot } from "./state";
import type { Keyword } from "./vocabulary";

type EffectKey = Brand<string, "EffectKey">;
const storedKey = (id: EffectId) => `s:${id}` as EffectKey;
const staticKey = (source: ObjectId, printedIndex: number) => `d:${source}:${printedIndex}` as EffectKey;
export const refKey = (source: ObjectId, ref: AbilityRef): EffectKey =>
    ref.kind === "printed"
        ? staticKey(source, ref.index)
        : (`g:${source}:${ref.index}:${ref.from.kind === "effect" ? storedKey(ref.from.id) : refKey(ref.from.source, ref.from.ability)}` as EffectKey);

type ModificationInfo = {
    key: EffectKey;
    source: ObjectId;
    controller: PlayerId;
    timestamp: Timestamp;
    modification: Modification;
    affects: Readonly<{ kind: "objects"; ids: ObjectId[] }> | Readonly<{ kind: "self" }> | ObjectMatch;
    grantOrigin: GrantOrigin;
    grantOffset: number;
};

type ActiveModificationInfo = Omit<ModificationInfo, "affects" | "modification"> & { affected: ReadonlySet<ObjectId> };

type CacheData = [Characteristics, { ref: AbilityRef; ability: Ability }[]];
type CacheInfo = Map<ObjectId, CacheData>;

const cache = new WeakMap<GameState["objects"], WeakMap<GameState["continuousEffects"], CacheInfo>>();

export function getCachedCharacteristics(state: GameState) {
    let byEffects = cache.get(state.objects);
    if (!byEffects) {
        byEffects = new WeakMap();
        cache.set(state.objects, byEffects);
    }
    let result = byEffects.get(state.continuousEffects);
    if (!result) {
        result = computeCharacteristics(state);
        byEffects.set(state.continuousEffects, result);
    }
    return result;
}

export function getMatchingObjects(state: GameState, cache: CacheInfo, scope: EvalScope, match: ObjectMatch): ReadonlySet<ObjectId> {
    const zonesToCheck = match.zones ?? ["battlefield"];
    const filter = match.filter;
    return new Set(
        zonesToCheck.flatMap((zone) =>
            getAllObjectsInZone(state, zone).filter((objId) => {
                const chars = cache.get(objId)?.[0];
                const obj = state.objects[objId];
                if (!obj || !chars) return false;
                const snapshot: ObjectSnapshot = {
                    ...obj,
                    chars,
                };
                return isTrue(evalObjectPredicate(scope, snapshot, filter));
            }),
        ),
    );
}

function computeCharacteristics(state: GameState): CacheInfo {
    const chars: CacheInfo = new Map(
        Object.values(state.objects).map((obj) => {
            const printedDef = state.definitions[obj.definitionId];
            const { id: _definitionId, ...characteristics } = printedDef!; // Currently includes isToken too, should change this at some point
            const printedAbilities: { ref: AbilityRef; ability: Ability }[] = printedDef!.abilities.map((a, i) => ({ ref: { kind: "printed", index: i }, ability: a }));
            return [obj.id, [characteristics, printedAbilities]];
        }),
    );

    const startedEffects: Map<EffectKey, ActiveModificationInfo> = new Map();

    for (const layer of LAYER_ORDER) {
        const layerEffects = getEffectsForLayer(state, chars, layer);
        for (const effect of layerEffects) {
            let affectedObjects: ReadonlySet<ObjectId>;
            if (startedEffects.has(effect.key)) {
                affectedObjects = startedEffects.get(effect.key)!.affected;
            } else {
                affectedObjects = getAffectedObjects(state, chars, effect);
                startedEffects.set(effect.key, { ...effect, affected: affectedObjects });
            }
            for (const objId of affectedObjects) {
                const oldChars = chars.get(objId);
                if (!oldChars) continue;
                chars.set(objId, applyModification(oldChars, effect));
            }
        }
        if (layer === "modifyPT") {
            applyPlusMinusCounters(state, chars);
        }
    }

    return chars;
}

function getEffectsForLayer(state: GameState, cache: CacheInfo, layer: Layer): ModificationInfo[] {
    const continuousEffects: ModificationInfo[] = state.continuousEffects.flatMap((effect) => {
        const offsets = grantOffsets(effect.modifications);
        return effect.modifications.flatMap((modification, i) =>
            LAYER_OF[modification.kind] === layer
                ? {
                      key: storedKey(effect.id),
                      source: effect.source,
                      controller: effect.controller,
                      timestamp: effect.timestamp,
                      affects: effect.affects,
                      modification,
                      grantOrigin: { kind: "effect", id: effect.id },
                      grantOffset: offsets[i]!,
                  }
                : [],
        );
    });

    const objEffects: ModificationInfo[] = [];
    for (const objId of state.battlefield) {
        const [chars, abilities] = cache.get(objId) ?? [undefined, []];
        if (!chars) continue;
        for (const abilityInfo of abilities.filter((a) => a.ability.kind === "static")) {
            if (abilityInfo.ability.kind !== "static") continue; // Need to double check so typescript doesn't complain
            if (!(abilityInfo.ability.activeZones === "all" || abilityInfo.ability.activeZones.includes("battlefield"))) continue;
            const offsets = grantOffsets(abilityInfo.ability.effect.modifications);
            for (const [i, modification] of abilityInfo.ability.effect.modifications.entries()) {
                const obj = state.objects[objId];
                if (!obj) continue;
                if (LAYER_OF[modification.kind] === layer) {
                    const key = refKey(objId, abilityInfo.ref);
                    objEffects.push({
                        key,
                        source: objId,
                        controller: obj.controller,
                        timestamp: obj.timestamp,
                        affects: abilityInfo.ability.effect.affects,
                        modification,
                        grantOrigin: { kind: "static", source: objId, ability: abilityInfo.ref },
                        grantOffset: offsets[i]!,
                    });
                }
            }
        }
    }
    return orderEffects([...continuousEffects, ...objEffects]);
}

function orderEffects(effects: ModificationInfo[]): ModificationInfo[] {
    // Making a separate function for when dependency sorting gets implemented
    return effects.sort((a, b) => a.timestamp - b.timestamp);
}

const grantCount = (m: Modification): number => (m.kind === "addKeywords" ? m.keywords.length : m.kind === "addAbilities" ? m.abilities.length : 0);

function grantOffsets(mods: readonly Modification[]): number[] {
    let running = 0;
    return mods.map((m) => {
        const offset = running;
        running += grantCount(m);
        return offset;
    });
}

function getAffectedObjects(state: GameState, cache: CacheInfo, effect: ModificationInfo): ReadonlySet<ObjectId> {
    switch (effect.affects.kind) {
        case "self":
            return new Set([effect.source]);
        case "objects":
            return new Set(effect.affects.ids);
        case "matching":
            return getMatchingObjects(
                state,
                cache,
                {
                    controller: effect.controller,
                    source: effect.source,
                    bindings: {},
                },
                effect.affects,
            );
    }
}

function applyPlusMinusCounters(state: GameState, cache: CacheInfo): void {
    for (const objId of state.battlefield) {
        const [chars, abilities] = cache.get(objId) ?? [undefined, []];
        const obj = state.objects[objId];
        if (!obj || !chars) continue;
        if (chars.types.includes("Creature")) {
            const plus = obj.counters["+1/+1"] ?? 0;
            const minus = obj.counters["-1/-1"] ?? 0;
            if (plus > 0 || minus > 0) {
                cache.set(objId, [{ ...chars, power: (chars.power ?? 0) + plus - minus, toughness: (chars.toughness ?? 0) + plus - minus }, abilities]);
            }
        } else {
            cache.set(objId, [{ ...chars, power: null, toughness: null }, abilities]);
        }
    }
}

function applyModification(cache: CacheData, modification: ModificationInfo): CacheData {
    const [c, a] = cache;
    const m = modification.modification;
    switch (m.kind) {
        case "modifyPT":
            return [c.power === null || c.toughness === null ? c : { ...c, power: c.power + m.power, toughness: c.toughness + m.toughness }, a];
        case "setPT":
            return [{ ...c, power: m.power, toughness: m.toughness }, a];
        case "addKeywords": {
            let currentCache = cache;
            m.keywords.forEach((keyword) => {
                currentCache = grantAbility(currentCache, modification, { kind: "keyword", keyword });
            });
            return currentCache;
        }
        case "addAbilities": {
            let currentCache = cache;
            m.abilities.forEach((a) => {
                currentCache = grantAbility(currentCache, modification, a);
            });
            return currentCache;
        }
        case "addTypes":
            return [{ ...c, types: [...new Set([...c.types, ...m.types])] }, a];
        case "setColors":
            return [{ ...c, colors: m.colors }, a];
        case "addColors":
            return [{ ...c, colors: [...new Set([...c.colors, ...m.colors])] }, a];
        case "addSubtypes":
            return [{ ...c, subtypes: [...new Set([...c.subtypes, ...m.types])] }, a];
        case "removeKeywords":
            return removeKeywords(cache, m.keywords);
        case "setTypes":
            return [{ ...c, types: m.types }, a];
        case "switchPT":
            return [{ ...c, power: c.toughness, toughness: c.power }, a];
        default:
            return assertNever(m);
    }
}

function grantAbility(cache: CacheData, mod: ModificationInfo, ability: Ability): CacheData {
    const [c, a] = cache;
    const newChars: Characteristics = { ...c, abilities: [...c.abilities, ability] };
    const newAbilityRef: AbilityRef = { kind: "granted", from: mod.grantOrigin, index: mod.grantOffset };
    const newAbilities = [...a, { ref: newAbilityRef, ability }];
    return [newChars, newAbilities];
}

function removeKeywords(cache: CacheData, keywords: readonly Keyword[]): CacheData {
    const [c, a] = cache;
    const shouldRemove = c.abilities.map((ability) => ability.kind === "keyword" && keywords.includes(ability.keyword));
    const newChars = { ...c, abilities: c.abilities.filter((_, i) => !shouldRemove[i]) };
    const newAbilities = a.filter((_, i) => !shouldRemove[i]);
    return [newChars, newAbilities];
}