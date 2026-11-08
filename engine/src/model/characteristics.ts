import type { Characteristics } from "./cardDefinition";
import type { ObjectId } from "./ids";
import { getCachedCharacteristics } from "./layers";
import type { GameState, ObjectSnapshot } from "./state";
import type { CardType, Keyword } from "./vocabulary";

export const isPermanentType = (t: CardType): boolean => t !== "Instant" && t !== "Sorcery";

/**
 * The object's current characteristics: its card's printed values with every applicable
 * continuous effect applied in layer order, then timestamp order.
 *
 * Simplifications to revisit: no dependency ordering inside a layer (CR 613.8)
 */
export function getCharacteristics(state: GameState, id: ObjectId): Characteristics | null {
    return getCachedCharacteristics(state).get(id) ?? null;
}

export function getCardName(state: GameState, id: ObjectId, withId?: boolean): string {
    const chars = getCharacteristics(state, id);
    if (!chars) return `#${id}`;
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

export function snapshotObject(state: GameState, id: ObjectId): ObjectSnapshot | undefined {
    const obj = state.objects[id];
    const chars = getCharacteristics(state, id);
    if (!obj || !chars) return undefined;
    return {
        id,
        chars,
        controller: obj.controller,
        owner: obj.owner,
        zone: obj.zone,
        tapped: obj.tapped,
        damage: obj.damage,
        counters: obj.counters,
    };
}
