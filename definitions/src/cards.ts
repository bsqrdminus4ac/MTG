import { cardDefId, type Ability, type CardDefinition, type ManaType } from "@mtg/engine";

const tapForMana = (mana: ManaType): Ability => ({
    kind: "activated",
    cost: { mana: null, tap: true, sacrificeSelf: false },
    isManaAbility: true,
    targets: [],
    effects: [{ kind: "addMana", mana, amount: 1 }],
    activateableZones: ["battlefield"],
    timingRestriction: "instantSpeed",
    description: `Tap: Add ${mana}`,
});

const discardThenGainLife = (): Ability => ({
    kind: "spell",
    targets: [{ kind: "Player", minCount: 1, maxCount: 1, allowedTypes: "any", zone: "battlefield" }],
    effects: [
        {
            kind: "choose",
            chooser: { kind: "target", index: 0 },
            from: { kind: "hand", of: { kind: "target", index: 0 } },
            min: 0,
            max: 10,
            bindAs: "cardsToDiscard",
            prompt: "Discard any number of cards (the caster gains 1 life for each)",
        },
        { kind: "discard", cards: { kind: "bound", name: "cardsToDiscard" } },
        { kind: "gainLife", who: { kind: "player", who: "controller" }, amount: { kind: "bound", name: "cardsToDiscard" } },
    ],
});

export const forest: CardDefinition = {
    id: cardDefId("forest"),
    name: "Forest",
    manaCost: null,
    colors: [],
    supertypes: ["Basic"],
    types: ["Land"],
    subtypes: ["Forest"],
    power: null,
    toughness: null,
    abilities: [tapForMana("G")],
};

export const mountain: CardDefinition = {
    ...forest,
    id: cardDefId("mountain"),
    name: "Mountain",
    subtypes: ["Mountain"],
    abilities: [tapForMana("R")],
};

export const bear: CardDefinition = {
    id: cardDefId("bear"),
    name: "Grizzly Bears",
    manaCost: { generic: 1, pips: ["G"] },
    colors: ["G"],
    supertypes: [],
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
    abilities: [],
};

export const drake: CardDefinition = {
    id: cardDefId("drake"),
    name: "Wind Drake",
    manaCost: { generic: 2, pips: ["U"] },
    colors: ["U"],
    supertypes: [],
    types: ["Creature"],
    subtypes: ["Drake"],
    power: 2,
    toughness: 2,
    abilities: [{ kind: "keyword", keyword: "flying" }],
};

export const bolt: CardDefinition = {
    id: cardDefId("bolt"),
    name: "Lightning Bolt",
    manaCost: { generic: 0, pips: ["R"] },
    colors: ["R"],
    supertypes: [],
    types: ["Instant"],
    subtypes: [],
    power: null,
    toughness: null,
    abilities: [
        {
            kind: "spell",
            targets: [
                {
                    kind: "AnyTarget",
                    zone: "battlefield",
                    minCount: 1,
                    maxCount: 1,
                },
            ],
            effects: [{ kind: "damage", to: { kind: "target", index: 0 }, amount: 3 }],
        },
    ],
};

export const discardLife: CardDefinition = {
    id: cardDefId("twist"),
    name: "Mind Twist",
    manaCost: { generic: 0, pips: ["R"] },
    colors: ["R"],
    supertypes: [],
    types: ["Sorcery"],
    subtypes: [],
    power: null,
    toughness: null,
    abilities: [discardThenGainLife()],
};

export const DEFINITIONS: readonly CardDefinition[] = [forest, mountain, bear, drake, bolt, discardLife];
