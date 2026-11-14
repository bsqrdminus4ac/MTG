import {
    COLORS,
    YOU,
    type Ability,
    type BindingRef,
    type Condition,
    type Effect,
    type EventBindingNames,
    type EventPredicate,
    type EventTrigger,
    type Keyword,
    type ManaType,
    type ObjectPredicate,
    type StaticEffect,
    type Step,
    type TargetSpec,
    type Zone,
} from "@mtg/engine";

export const fromEvent = <K extends keyof EventBindingNames>(_event: K, name: EventBindingNames[K]): BindingRef => ({ kind: "bound", name });

export const tapForMana = (mana: ManaType): Ability => ({
    kind: "activated",
    cost: { tap: true },
    isManaAbility: true,
    targets: [],
    effects: [{ kind: "addMana", mana: { kind: "mana", type: mana }, amount: 1 }],
    activateableZones: ["battlefield"],
    timingRestriction: "instantSpeed",
    text: `Tap: Add ${mana}.`,
});

export const manaOfAnyColor = (includeColorless?: boolean): ManaType[] => (includeColorless ? [...COLORS, "C"] : [...COLORS]);

export const drawCards = (amount: number): Effect => ({ kind: "draw", count: amount, who: { kind: "player", who: "controller" } });

export const triggered = (a: { trigger: EventTrigger; effects: Effect[]; targets?: TargetSpec[]; triggerableZones?: Zone[]; text: string }): Ability => ({
    kind: "triggered",
    trigger: a.trigger,
    effects: a.effects,
    targets: a.targets ?? [],
    triggerableZones: a.triggerableZones ?? ["battlefield"],
    text: a.text,
});

export const staticAbility = (a: { effect: StaticEffect; activeZones?: Zone[]; text: string }): Ability => ({
    kind: "static",
    effect: a.effect,
    activeZones: a.activeZones ?? ["battlefield"],
    text: a.text,
});

export const thisEntersTheBattlefield = (interveningIf?: Condition): EventTrigger =>
    interveningIf
        ? {
              event: "cardMoved",
              when: {
                  kind: "cardMoved",
                  object: { kind: "isSource" },
                  to: "battlefield",
              },
              interveningIf,
          }
        : {
              event: "cardMoved",
              when: {
                  kind: "cardMoved",
                  object: { kind: "isSource" },
                  to: "battlefield",
              },
          };

export const atBeginningOfStep = (which: "your" | "any", step: Step): EventPredicate => ({
    kind: "stepStarted",
    step,
    player: which === "your" ? { kind: "you" } : { kind: "anyPlayer" },
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
        },
        { kind: "discard", cards: { kind: "bound", name: "cardsToDiscard" } },
        { kind: "gainLife", who: YOU, amount: { kind: "bound", name: "cardsToDiscard" } },
    ],
    text: "Target player discards any number of cards. You gain 1 life for each card discarded this way.",
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
        },
    ],
    text: "Each player discards a card.",
});

export const anthem = (filter: ObjectPredicate, power: number, toughness: number, text: string) =>
    staticAbility({ effect: { affects: { kind: "matching", filter }, modifications: [{ kind: "modifyPT", power, toughness }] }, text });

export const grantKeyword = (filter: ObjectPredicate, keywords: Keyword[], text: string) =>
    staticAbility({ effect: { affects: { kind: "matching", filter }, modifications: [{ kind: "addKeywords", keywords }] }, text });

export const thisGets = (power: number, toughness: number, text: string) => staticAbility({ effect: { affects: { kind: "self" }, modifications: [{ kind: "modifyPT", power, toughness }] }, text });

export const creaturesYouControl = (excludeSource?: boolean): ObjectPredicate => ({
    kind: "all",
    of: [
        { kind: "inZone", zone: "battlefield" },
        { kind: "hasType", type: "Creature" },
        { kind: "controlledBy", who: "you" },
        ...(excludeSource ? [{ kind: "not", of: { kind: "isSource" } } as ObjectPredicate] : []),
    ],
});

export const whenThisDies = (): EventTrigger => ({ event: "cardMoved", when: { kind: "cardMoved", from: "battlefield", to: "graveyard", object: { kind: "isSource" } } });