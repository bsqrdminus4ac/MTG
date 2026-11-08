import { isTrue } from "../core/result";
import { assertNever } from "../core/util";
import type { Ability } from "./abilities";
import type { Characteristics } from "./cardDefinition";
import { LAYER_OF, LAYER_ORDER, type Layer, type Modification, type ObjectMatch } from "./continuous";
import type { Brand, EffectId, ObjectId, PlayerId, Timestamp } from "./ids";
import { evalObjectPredicate } from "./objectPredicates";
import { getAllObjectsInZone, type EvalScope, type GameState, type ObjectSnapshot } from "./state";

type EffectKey = Brand<string, "EffectKey">;
const storedKey = (id: EffectId) => `s:${id}` as EffectKey;
const staticKey = (source: ObjectId, printedIndex: number) => `d:${source}:${printedIndex}` as EffectKey;

type ModificationInfo = {
    key: EffectKey;
    source: ObjectId;
    controller: PlayerId;
    timestamp: Timestamp;
    modification: Modification;
    affects: Readonly<{ kind: "objects"; ids: ObjectId[] }> | Readonly<{ kind: "self" }> | ObjectMatch;
};

type ActiveModificationInfo = Omit<ModificationInfo, "affects" | "modification"> & { affected: ReadonlySet<ObjectId> };

const cache = new WeakMap<GameState["objects"], WeakMap<GameState["continuousEffects"], Map<ObjectId, Characteristics>>>();

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

export function getMatchingObjects(state: GameState, currentChars: Map<ObjectId, Characteristics>, scope: EvalScope, match: ObjectMatch): ReadonlySet<ObjectId> {
    const zonesToCheck = match.zones ?? ["battlefield"];
    const filter = match.filter;
    return new Set(
        zonesToCheck.flatMap((zone) =>
            getAllObjectsInZone(state, zone).filter((objId) => {
                const chars = currentChars.get(objId);
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

function computeCharacteristics(state: GameState): Map<ObjectId, Characteristics> {
    const chars = new Map(
        Object.values(state.objects).map((obj) => {
            const printedDef = state.definitions[obj.definitionId];
            const { id: _definitionId, ...characteristics } = printedDef!; // Currently includes isToken too, should change this at some point
            return [obj.id, characteristics];
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
                chars.set(objId, applyModification(oldChars, effect.modification));
            }
        }
        if (layer === "modifyPT") {
            applyPlusMinusCounters(state, chars);
        }
    }

    return chars;
}

function getEffectsForLayer(state: GameState, currentChars: Map<ObjectId, Characteristics>, layer: Layer): ModificationInfo[] {
    const continuousEffects: ModificationInfo[] = state.continuousEffects.flatMap((effect) =>
        effect.modifications
            .filter((m) => LAYER_OF[m.kind] === layer)
            .map((modification) => ({
                key: storedKey(effect.id),
                source: effect.source,
                controller: effect.controller,
                timestamp: effect.timestamp,
                affects: effect.affects,
                modification,
            })),
    );

    const objEffects: ModificationInfo[] = [];
    for (const objId of state.battlefield) {
        const chars = currentChars.get(objId);
        if (!chars) continue;
        // Need to rework index => key logic when abilities can be granted
        for (const [abilityIndex, ability] of chars.abilities.filter((a) => a.kind === "static").entries()) {
            if (!(ability.activeZones === "all" || ability.activeZones.includes("battlefield"))) continue;
            for (const modification of ability.effect.modifications) {
                const obj = state.objects[objId];
                if (!obj) continue;
                if (LAYER_OF[modification.kind] === layer)
                    objEffects.push({ key: staticKey(objId, abilityIndex), source: objId, controller: obj.controller, timestamp: obj.timestamp, affects: ability.effect.affects, modification });
            }
        }
    }
    return orderEffects([...continuousEffects, ...objEffects]);
}

function orderEffects(effects: ModificationInfo[]): ModificationInfo[] {
    // Making a separate function for when dependency sorting gets implemented
    return effects.sort((a, b) => a.timestamp - b.timestamp);
}

function getAffectedObjects(state: GameState, currentChars: Map<ObjectId, Characteristics>, effect: ModificationInfo): ReadonlySet<ObjectId> {
    switch (effect.affects.kind) {
        case "self":
            return new Set([effect.source]);
        case "objects":
            return new Set(effect.affects.ids);
        case "matching":
            return getMatchingObjects(
                state,
                currentChars,
                {
                    controller: effect.controller,
                    source: effect.source,
                    bindings: {},
                },
                effect.affects,
            );
    }
}

function applyPlusMinusCounters(state: GameState, currentChars: Map<ObjectId, Characteristics>): void {
    for (const objId of state.battlefield) {
        const chars = currentChars.get(objId);
        const obj = state.objects[objId];
        if (!obj || !chars) continue;
        if (chars.types.includes("Creature")) {
            const plus = obj.counters["+1/+1"] ?? 0;
            const minus = obj.counters["-1/-1"] ?? 0;
            if (plus > 0 || minus > 0) {
                currentChars.set(objId, { ...chars, power: (chars.power ?? 0) + plus - minus, toughness: (chars.toughness ?? 0) + plus - minus });
            }
        } else {
            currentChars.set(objId, { ...chars, power: null, toughness: null });
        }
    }
}

function applyModification(c: Characteristics, m: Modification): Characteristics {
    switch (m.kind) {
        case "modifyPT":
            return c.power === null || c.toughness === null ? c : { ...c, power: c.power + m.power, toughness: c.toughness + m.toughness };
        case "setPT":
            return { ...c, power: m.power, toughness: m.toughness };
        case "addKeywords":
            return { ...c, abilities: [...c.abilities, ...m.keywords.map<Ability>((keyword) => ({ kind: "keyword", keyword }))] };
        case "addTypes":
            return { ...c, types: [...new Set([...c.types, ...m.types])] };
        case "setColors":
            return { ...c, colors: m.colors };
        case "addColors":
            return { ...c, colors: [...new Set([...c.colors, ...m.colors])] };
        case "addSubtypes":
            return { ...c, subtypes: [...new Set([...c.subtypes, ...m.types])] };
        case "removeKeywords":
            return { ...c, abilities: c.abilities.filter((a) => !(a.kind === "keyword" && m.keywords.includes(a.keyword))) };
        case "setTypes":
            return { ...c, types: m.types };
        case "switchPT":
            return { ...c, power: c.toughness, toughness: c.power };
        default:
            return assertNever(m);
    }
}
