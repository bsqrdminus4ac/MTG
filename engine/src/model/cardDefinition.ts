import type { Ability } from "./abilities";
import type { CardDefId } from "./ids";
import type { Color, ManaCost } from "./mana";
import type { CardType, Supertype } from "./vocabulary";

/** The copiable values of an object (CR 109.3). Derived per-object by getCharacteristics. */
export interface Characteristics {
    readonly name: string;
    readonly manaCost: ManaCost | null;
    readonly colors: readonly Color[];
    readonly supertypes: readonly Supertype[];
    readonly types: readonly CardType[];
    readonly subtypes: readonly string[];
    readonly power: number | null;
    readonly toughness: number | null;
    readonly abilities: readonly Ability[];
}

/** Static card data. Many game objects can share one definition. */
export interface CardDefinition extends Characteristics {
    readonly id: CardDefId;
    readonly isToken?: boolean;
}
