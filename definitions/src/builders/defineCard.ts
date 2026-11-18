import { type Ability, type CardDefinition, type CardType, type Color, type CostComponent, type ManaCost, type NonManaCost, type Supertype, cardDefId, colorIdentity, parseCost } from "@mtg/engine";

export const mana = (cost: ManaCost | string): CostComponent => ({ kind: "mana", cost: typeof cost === "string" ? parseCost(cost) : cost });

export const creature = (c: {
    name: string;
    cost: ManaCost | string;
    additionalCosts?: NonManaCost[];
    subtypes?: string[];
    power: number;
    toughness: number;
    abilities?: Ability[];
    colors?: Color[];
    isLegendary?: boolean;
    additionalTypes?: CardType[];
}): CardDefinition => {
    const manaCost = parseCost(c.cost);
    return {
        id: cardDefId(c.name),
        name: c.name,
        cost: [{ kind: "mana", cost: manaCost }, ...(c.additionalCosts ?? [])],
        colors: c.colors ?? colorIdentity(manaCost), // derived from the cost pips, overridable
        supertypes: c.isLegendary ? ["Legendary"] : [],
        types: ["Creature", ...(c.additionalTypes ?? [])],
        subtypes: c.subtypes ?? [],
        power: c.power,
        toughness: c.toughness,
        abilities: c.abilities ?? [],
    };
};

export const land = (c: { name: string; subtypes?: string[]; abilities: Ability[]; isBasic?: boolean; isLegendary?: boolean; isSnow?: boolean }): CardDefinition => ({
    id: cardDefId(c.name),
    name: c.name,
    cost: null,
    colors: [],
    supertypes: [c.isBasic && "Basic", c.isLegendary && "Legendary", c.isSnow && "Snow"].filter((x): x is Supertype => !!x),
    types: ["Land"],
    subtypes: c.subtypes ?? [],
    power: null,
    toughness: null,
    abilities: c.abilities,
});

export const instant = (c: {
    name: string;
    cost: ManaCost | string;
    additionalCosts?: NonManaCost[];
    subtypes?: string[];
    abilities: Ability[];
    colors?: Color[];
    isLegendary?: boolean;
}): CardDefinition => {
    const manaCost = parseCost(c.cost);
    return {
        id: cardDefId(c.name),
        name: c.name,
        cost: [{ kind: "mana", cost: manaCost }, ...(c.additionalCosts ?? [])],
        colors: c.colors ?? colorIdentity(manaCost), // derived from the cost pips, overridable
        supertypes: c.isLegendary ? ["Legendary"] : [],
        types: ["Instant"],
        subtypes: c.subtypes ?? [],
        power: null,
        toughness: null,
        abilities: c.abilities,
    };
};

export const sorcery = (c: {
    name: string;
    cost: ManaCost | string;
    additionalCosts?: NonManaCost[];
    subtypes?: string[];
    abilities: Ability[];
    colors?: Color[];
    isLegendary?: boolean;
}): CardDefinition => {
    const manaCost = parseCost(c.cost);
    return {
        id: cardDefId(c.name),
        name: c.name,
        cost: [{ kind: "mana", cost: manaCost }, ...(c.additionalCosts ?? [])],
        colors: c.colors ?? colorIdentity(manaCost), // derived from the cost pips, overridable
        supertypes: c.isLegendary ? ["Legendary"] : [],
        types: ["Sorcery"],
        subtypes: c.subtypes ?? [],
        power: null,
        toughness: null,
        abilities: c.abilities,
    };
};

export const noncreatureArtifact = (c: {
    name: string;
    cost: ManaCost | string;
    additionalCosts?: NonManaCost[];
    subtypes?: string[];
    abilities: Ability[];
    colors?: Color[];
    isLegendary?: boolean;
    additionalTypes?: CardType[];
}): CardDefinition => {
    const manaCost = parseCost(c.cost);
    return {
        id: cardDefId(c.name),
        name: c.name,
        cost: [{ kind: "mana", cost: manaCost }, ...(c.additionalCosts ?? [])],
        colors: c.colors ?? colorIdentity(manaCost), // derived from the cost pips, overridable
        supertypes: c.isLegendary ? ["Legendary"] : [],
        types: ["Artifact", ...(c.additionalTypes ?? [])],
        subtypes: c.subtypes ?? [],
        power: null,
        toughness: null,
        abilities: c.abilities,
    };
};

export const enchantment = (c: {
    name: string;
    cost: ManaCost | string;
    additionalCosts?: NonManaCost[];
    subtypes?: string[];
    abilities: Ability[];
    colors?: Color[];
    isLegendary?: boolean;
    additionalTypes?: CardType[];
}): CardDefinition => {
    const manaCost = parseCost(c.cost);
    return {
        id: cardDefId(c.name),
        name: c.name,
        cost: [{ kind: "mana", cost: manaCost }, ...(c.additionalCosts ?? [])],
        colors: c.colors ?? colorIdentity(manaCost), // derived from the cost pips, overridable
        supertypes: c.isLegendary ? ["Legendary"] : [],
        types: ["Enchantment", ...(c.additionalTypes ?? [])],
        subtypes: c.subtypes ?? [],
        power: null,
        toughness: null,
        abilities: c.abilities,
    };
};
