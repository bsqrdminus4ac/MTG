import { anyTarget, cardDefId, type Ability, type CardDefinition, type ManaType } from "@mtg/engine";

const tapForMana = (mana: ManaType): Ability => ({
    kind: "activated",
    cost: { mana: null, tap: true, sacrificeSelf: false },
    isManaAbility: true,
    targets: [],
    effects: [{ kind: "addMana", mana, amount: 1, description: `Tap: Add ${mana}` }],
    activateableZones: ["battlefield"],
    timingRestriction: "instantSpeed",
});

const discardThenGainLife = (): Ability => ({
    kind: "spell",
    targets: [{ filter: { kind: "player", filter: { kind: "anyPlayer" } }, minCount: 1, maxCount: 1 }],
    effects: [
        {
            kind: "choose",
            chooser: { kind: "target", spec: 0 },
            from: { kind: "hand", of: { kind: "target", spec: 0 } },
            min: 0,
            max: 10,
            bindAs: "cardsToDiscard",
            prompt: "Discard any number of cards (the caster gains 1 life for each)",
            description: "Target player discards any number of cards.",
        },
        { kind: "discard", cards: { kind: "bound", name: "cardsToDiscard" } },
        { kind: "gainLife", who: { kind: "player", who: "controller" }, amount: { kind: "bound", name: "cardsToDiscard" }, description: "You gain 1 life for each card discarded this way" },
    ],
});

const eachPlayerDiscards = (amount: number): Ability => ({
    kind: "spell",
    targets: [],
    effects: [
        {
            kind: "forEach",
            over: { kind: "player", who: "eachPlayer" },
            as: "p",
            body: [
                {
                    kind: "choose",
                    bindAs: "picked",
                    prompt: "Discard a card",
                    chooser: { kind: "bound", name: "p" },
                    from: { kind: "hand", of: { kind: "bound", name: "p" } },
                    max: amount,
                    min: amount,
                },
                { kind: "discard", cards: { kind: "bound", name: "picked" } },
            ],
            description: "Each player discards a card",
        },
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
                    filter: anyTarget(),
                    minCount: 1,
                    maxCount: 1,
                },
            ],
            effects: [{ kind: "damage", to: { kind: "target", spec: 0 }, amount: 3, description: "<this> deals 3 damage to any target" }],
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

export const skeins: CardDefinition = {
    id: cardDefId("skeins"),
    name: "Delirium Skeins",
    manaCost: { generic: 0, pips: ["G"] },
    abilities: [eachPlayerDiscards(3)],
    colors: ["B"],
    supertypes: [],
    types: ["Sorcery"],
    subtypes: [],
    power: null,
    toughness: null,
};

export const DEFINITIONS: readonly CardDefinition[] = [forest, mountain, bear, drake, bolt, discardLife, skeins];
