import type { Ability, ManaType } from "@mtg/engine";


export const tapForMana = (mana: ManaType): Ability => ({
    kind: "activated",
    cost: { mana: null, tap: true, sacrificeSelf: false },
    isManaAbility: true,
    targets: [],
    effects: [{ kind: "addMana", mana, amount: 1, description: `Tap: Add ${mana}` }],
    activateableZones: ["battlefield"],
    timingRestriction: "instantSpeed",
});

export const discardThenGainLife = (): Ability => ({
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
        { kind: "gainLife", who: { kind: "player", who: "controller" }, amount: { kind: "bound", name: "cardsToDiscard" }, description: "You gain 1 life for each card discarded this way." },
    ],
});

export const eachPlayerDiscards = (amount: number): Ability => ({
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
            description: "Each player discards a card.",
        },
    ],
});