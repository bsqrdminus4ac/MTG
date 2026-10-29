import type { Ability, AbilityOfKind } from "../model/abilities";
import { getCardName, getCharacteristics } from "../model/characteristics";
import type { Effect, TargetSpec } from "../model/effects";
import type { GameState, SourceSnapshot, StackEntry } from "../model/state";

type StackAbility = AbilityOfKind<"spell" | "activated" | "triggered">;

export function getEntryEffects(state: GameState, entry: StackEntry): readonly Effect[] {
    return getAbilityOfEntry(state, entry)?.effects ?? [];
}

export function getEntryTargetSpecs(state: GameState, entry: StackEntry): readonly TargetSpec[] {
    return getAbilityOfEntry(state, entry)?.targets ?? [];
}

export function getAbilityOfEntry(state: GameState, entry: StackEntry): StackAbility | undefined {
    if (entry.kind === "spell") {
        let ability: Ability | undefined;
        const chars = getCharacteristics(state, entry.source);
        if (!chars?.abilities) return undefined;
        if (entry.spellIndex) {
            ability = chars.abilities[entry.spellIndex];
            if (ability?.kind !== "spell") return undefined;
        } else {
            ability = chars.abilities.find((a) => a.kind === "spell");
        }
        return ability;
    } else {
        return entry.ability;
    }
}

export const getEntryName = (state: GameState, entry: StackEntry): string => {
    if (entry.kind === "spell") return getCardName(state, entry.source);
    return `${entry.sourceSnapshot.chars.name}'s ability`;
};

export function snapshotEntrySource(state: GameState, entry: StackEntry): SourceSnapshot | null {
    const obj = state.objects[entry.source];
    if (!obj) return null;
    const chars = getCharacteristics(state, obj.id);
    if (!chars) return null;
    return {
        chars,
        controller: obj.controller,
        id: obj.id,
        owner: obj.owner,
    };
}