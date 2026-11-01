import type { DistributiveOmit } from "../core/util";
import type { AbilityOfKind } from "../model/abilities";
import type { Characteristics } from "../model/cardDefinition";
import { getCardName, isPermanentType } from "../model/characteristics";
import { nextID, type StackId } from "../model/ids";
import type { GameState, StackEntry } from "../model/state";

//type StackAbility = AbilityOfKind<"spell" | "activated" | "triggered">;

export const getEntryName = (state: GameState, entry: StackEntry): string => {
    if (entry.kind === "spell") return getCardName(state, entry.source);
    return `${entry.sourceSnapshot.chars.name}'s ability`;
};

const PERMANENT_SPELL: AbilityOfKind<"spell"> = { kind: "spell", targets: [], effects: [] };

export function getAbilityForSpell(chars: Characteristics): AbilityOfKind<"spell"> | null {
    const printed = chars.abilities.find((a) => a.kind === "spell");
    if (printed) return printed;
    return chars.types.some((t) => isPermanentType(t)) ? PERMANENT_SPELL : null; // null = instant/sorcery with no text, not castable
}

export type NewStackEntry = DistributiveOmit<StackEntry, "id">;

export function pushStackEntry(state: GameState, entry: NewStackEntry): { state: GameState; entry: StackEntry } {
    const [next, id] = nextID<StackId>(state);
    const full = { ...entry, id } as StackEntry;
    return {
        entry: full,
        state: {
            ...next,
            stack: [...next.stack, full],
            priority: { holder: entry.controller, consecutivePasses: 0 }, // the pass-count reset from before
        },
    };
}
