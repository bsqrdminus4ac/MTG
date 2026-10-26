import { assertNever } from "../core/util";
import type { Characteristics } from "./cardDefinition";
import { type Modification, LAYER_ORDER, layerOf } from "./continuous";
import type { ObjectId } from "./ids";
import type { GameState } from "./state";
import type { CardType, Keyword } from "./vocabulary";

export const isPermanentType = (t: CardType): boolean => t !== "Instant" && t !== "Sorcery";

function applyModification(c: Characteristics, m: Modification): Characteristics {
    switch (m.kind) {
        case "modifyPT":
            return c.power === null || c.toughness === null ? c : { ...c, power: c.power + m.power, toughness: c.toughness + m.toughness };
        case "setPT":
            return { ...c, power: m.power, toughness: m.toughness };
        case "addKeyword":
            return { ...c, abilities: [...c.abilities, { kind: "keyword", keyword: m.keyword }] };
        case "addType":
            return c.types.includes(m.type) ? c : { ...c, types: [...c.types, m.type] };
        case "setColors":
            return { ...c, colors: m.colors };
        default:
            return assertNever(m);
    }
}

/**
 * The object's current characteristics: its card's printed values with every applicable
 * continuous effect applied in layer order, then timestamp order.
 *
 * Simplifications to revisit: no dependency ordering inside a layer (CR 613.8), and
 * "allCreatures" is checked against the in-progress characteristics.
 */
export function getCharacteristics(state: GameState, id: ObjectId): Characteristics | null {
    const obj = state.objects[id];
    if (!obj) return null;
    const def = state.definitions[obj.definitionId];
    if (!def) return null;

    const { id: _definitionId, ...printed } = def;
    let current: Characteristics = printed;

    const ordered = [...state.continuousEffects].sort((a, b) => LAYER_ORDER.indexOf(layerOf(a.modification)) - LAYER_ORDER.indexOf(layerOf(b.modification)) || a.timestamp - b.timestamp);

    for (const effect of ordered) {
        const applies = effect.affects.kind === "object" ? effect.affects.id === id : obj.zone === "battlefield" && current.types.includes("Creature");
        if (applies) current = applyModification(current, effect.modification);
    }
    return current;
}

export function getCardName(state: GameState, id: ObjectId, withId?: boolean): string {
    const chars = getCharacteristics(state, id);
    if (!chars) return "";
    return chars.name + (withId ? ` (#${id})` : "");
}

export function hasKeyword(state: GameState, obj: ObjectId, keyword: Keyword): boolean {
    const chars = getCharacteristics(state, obj);
    if (!chars) return false;
    return chars.abilities.some((a) => a.kind === "keyword" && a.keyword === keyword);
}

export function hasCardType(state: GameState, obj: ObjectId, type: CardType): boolean {
    const chars = getCharacteristics(state, obj);
    if (!chars) return false;
    return chars.types.includes(type);
}
