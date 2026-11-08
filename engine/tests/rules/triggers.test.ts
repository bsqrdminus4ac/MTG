import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/rules/triggers", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/rules/triggers")>();
    return {
        ...actual,
        detectTriggers: vi.fn(actual.detectTriggers),
    };
});

import { applyAction, submitAnswer } from "../../src/engine";
import { grantPriority } from "../../src/flow/priority";
import { runResolution } from "../../src/flow/resolution";
import { placePendingTriggers } from "../../src/flow/triggers";
import type { AbilityOfKind } from "../../src/model/abilities";
import type { CardDefinition } from "../../src/model/cardDefinition";
import { snapshotObject } from "../../src/model/characteristics";
import { cardDefId, playerId, type StackId } from "../../src/model/ids";
import type { GameState, Target } from "../../src/model/state";
import { moveObject } from "../../src/model/zones";
import { detectTriggers } from "../../src/rules/triggers";
import { createGame } from "../../src/setup";
import { moveDefinition } from "../helpers";

const alice = playerId("alice");
const bob = playerId("bob");

const creature = (id: string, abilities: readonly AbilityOfKind<"triggered">[] = []): CardDefinition => ({
    id: cardDefId(id),
    name: id,
    manaCost: { generic: 0, pips: [] },
    colors: [],
    supertypes: [],
    types: ["Creature"],
    subtypes: [],
    power: 2,
    toughness: 2,
    abilities,
});

const entersAbility: AbilityOfKind<"triggered"> = {
    kind: "triggered",
    trigger: {
        event: "cardMoved",
        when: { kind: "cardMoved", object: { kind: "isSource" }, to: "battlefield" },
    },
    targets: [],
    effects: [],
    triggerableZones: ["battlefield"],
};

function lifeChangedAbility(effects: AbilityOfKind<"triggered">["effects"] = []): AbilityOfKind<"triggered"> {
    return {
        kind: "triggered",
        trigger: { event: "lifeChanged", when: { kind: "lifeChanged" } },
        targets: [],
        effects,
        triggerableZones: ["battlefield"],
    };
}

function detectLifeChangedTriggers(state: GameState) {
    return detectTriggers(state, [{ type: "lifeChanged", player: bob, delta: -1 }]);
}

const diesAbility: AbilityOfKind<"triggered"> = {
    kind: "triggered",
    trigger: {
        event: "cardMoved",
        when: { kind: "cardMoved", object: { kind: "isSource" }, from: "battlefield", to: "graveyard" },
    },
    targets: [],
    effects: [],
    triggerableZones: ["battlefield"],
};

const damageAbility: AbilityOfKind<"triggered"> = {
    kind: "triggered",
    trigger: { event: "damageDealt", when: { kind: "damageDealt" } },
    targets: [],
    effects: [],
    triggerableZones: ["battlefield"],
};

function game(definitions: readonly CardDefinition[], aliceDeck: readonly CardDefinition[] = definitions, bobDeck: readonly CardDefinition[] = []): GameState {
    return createGame(definitions, [
        { id: alice, deck: aliceDeck.map((definition) => definition.id) },
        { id: bob, deck: bobDeck.map((definition) => definition.id) },
    ]);
}

const triggerSpy = vi.mocked(detectTriggers);

beforeEach(() => {
    triggerSpy.mockClear();
});

describe("detectTriggers", () => {
    test("detects an enters-the-battlefield trigger when played, but not on a move to the graveyard", () => {
        const permanent = creature("enters", [entersAbility]);
        const initial = game([permanent]);
        const inHand = moveDefinition(initial, alice, permanent, "hand");
        const entered = moveObject(inHand.state, inHand.newId, "battlefield");
        if (!entered) throw new Error("Unable to play the permanent");

        const entering = detectTriggers(entered.state, entered.events);
        expect(entering.ok).toBe(true);
        if (!entering.ok) return;
        expect(entered.state.pendingTriggers[alice]).toBeUndefined();
        expect(entering.state.pendingTriggers[alice]).toHaveLength(1);
        expect(entering.state.pendingTriggers[alice]?.[0]?.event).toEqual(entered.events[0]);
        expect(entered.events[0]?.type === "cardMoved" ? entered.events[0].after : undefined).toEqual(entering.state.pendingTriggers[alice]?.[0]?.lki);

        const died = moveObject(entered.state, entered.newId, "graveyard");
        if (!died) throw new Error("Unable to move the permanent to the graveyard");
        const leaving = detectTriggers(died.state, died.events);
        expect(leaving.ok).toBe(true);
        if (!leaving.ok) return;
        expect(leaving.state.pendingTriggers[alice]).toBeUndefined();
    });

    test("detects a creature's dies trigger from its last-known information", () => {
        const permanent = creature("dies", [diesAbility]);
        const entered = moveDefinition(game([permanent]), alice, permanent, "battlefield");
        const died = moveObject(entered.state, entered.newId, "graveyard");
        if (!died) throw new Error("Unable to move the creature to the graveyard");

        const result = detectTriggers(died.state, died.events);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(died.state.objects[entered.newId]).toBeUndefined();
        expect(result.state.pendingTriggers[alice]).toHaveLength(1);
        expect(result.state.pendingTriggers[alice]?.[0]?.lki).toEqual(died.events[0]?.type === "cardMoved" ? died.events[0].before : undefined);
        expect(result.state.pendingTriggers[alice]?.[0]?.lki?.zone).toBe("battlefield");
    });

    test("does not detect a trigger when its intervening-if condition is false", () => {
        const ability: AbilityOfKind<"triggered"> = {
            kind: "triggered",
            trigger: {
                event: "lifeChanged",
                when: { kind: "lifeChanged" },
                interveningIf: { kind: "compare", left: 1, op: ">", right: 2 },
            },
            targets: [],
            effects: [],
            triggerableZones: ["battlefield"],
        };
        const permanent = creature("false-condition", [ability]);
        const source = moveDefinition(game([permanent]), alice, permanent, "battlefield");
        const result = detectTriggers(source.state, [{ type: "lifeChanged", player: bob, delta: -1 }]);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.state.pendingTriggers[alice]).toBeUndefined();
    });

    test("does not detect an ability while its object is outside triggerable zones", () => {
        const ability: AbilityOfKind<"triggered"> = {
            kind: "triggered",
            trigger: { event: "lifeChanged", when: { kind: "lifeChanged" } },
            targets: [],
            effects: [],
            triggerableZones: ["battlefield"],
        };
        const permanent = creature("wrong-zone", [ability]);
        const source = moveDefinition(game([permanent]), alice, permanent, "hand");
        const result = detectTriggers(source.state, [{ type: "lifeChanged", player: bob, delta: -1 }]);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.state.pendingTriggers[alice]).toBeUndefined();
    });

    test("places triggers caused during resolution only after resolution completes", () => {
        const watcher = creature("damage-watcher", [damageAbility]);
        const sourceCard = creature("damage-source");
        const initial = game([watcher, sourceCard]);
        const sourceOnBattlefield = moveDefinition(initial, alice, watcher, "battlefield");
        const source = sourceOnBattlefield.state.players[alice]?.library.find((id) => sourceOnBattlefield.state.objects[id]?.definitionId === sourceCard.id);
        if (source === undefined) throw new Error("Missing resolving source");
        const sourceLki = snapshotObject(sourceOnBattlefield.state, source);
        if (!sourceLki) throw new Error("Missing resolving source snapshot");
        const resolvingAbility: AbilityOfKind<"activated"> = {
            kind: "activated",
            cost: {},
            targets: [],
            effects: [],
            activateableZones: ["battlefield"],
            timingRestriction: "instantSpeed",
        };
        const targets: readonly (readonly Target[])[] = [[{ kind: "player", id: bob }]];
        const state: GameState = {
            ...sourceOnBattlefield.state,
            priority: null,
            resolving: {
                entry: {
                    kind: "ability",
                    id: sourceOnBattlefield.state.nextId as StackId,
                    controller: alice,
                    source,
                    targets,
                    bindings: {},
                    ability: resolvingAbility,
                    sourceSnapshot: sourceLki,
                },
                frames: [
                    {
                        effects: [
                            { kind: "damage", to: { kind: "target", spec: 0 }, amount: 1 },
                            { kind: "askYesNo", who: { kind: "player", who: "controller" }, prompt: "Continue?", bindAs: "continue" },
                        ],
                        pc: 0,
                    },
                ],
                bindings: {},
                legalTargets: [[true]],
                sourceSnapshot: sourceLki,
            },
        };

        const paused = runResolution(state);

        expect(paused.ok).toBe(true);
        if (!paused.ok) return;
        expect(paused.state.pending?.kind).toBe("yesNo");
        expect(paused.state.pendingTriggers[alice]).toHaveLength(1);
        expect(paused.state.stack.filter((entry) => entry.kind === "ability" && entry.ability.kind === "triggered")).toHaveLength(0);
        expect(triggerSpy.mock.calls.flatMap(([, events]) => events).filter((event) => event.type === "damageDealt")).toHaveLength(1);

        if (paused.state.pending?.kind !== "yesNo") return;
        const resumed = submitAnswer(paused.state, {
            player: alice,
            decision: paused.state.pending.id,
            answer: { kind: "yesNo", value: true },
        });

        expect(resumed.ok).toBe(true);
        if (!resumed.ok) return;
        expect(resumed.state.pendingTriggers[alice]).toBeUndefined();
        expect(resumed.state.stack.filter((entry) => entry.kind === "ability" && entry.ability.kind === "triggered")).toHaveLength(1);
        expect(triggerSpy.mock.calls.flatMap(([, events]) => events).filter((event) => event.type === "damageDealt")).toHaveLength(1);
    });

    test("scans each emitted event in a scripted game exactly once", () => {
        const land: CardDefinition = {
            ...creature("test-land"),
            types: ["Land"],
            power: null,
            toughness: null,
        };
        const initial = game([land]);
        const inHand = moveDefinition(initial, alice, land, "hand");
        triggerSpy.mockClear();

        const state = { ...inHand.state, turn: { ...inHand.state.turn, step: "precombatMain" as const } };
        const played = applyAction(state, { type: "playLand", player: alice, card: inHand.newId });

        expect(played.ok).toBe(true);
        if (!played.ok) return;
        expect(triggerSpy).toHaveBeenCalledTimes(1);
        const scannedEvents = triggerSpy.mock.calls.flatMap(([, events]) => events);
        expect(scannedEvents).toEqual(played.events);
        expect(new Set(scannedEvents)).toHaveProperty("size", played.events.length);
    });

    test("creates a trigger instance for each watcher of the same event", () => {
        const firstWatcher = creature("first-watcher", [
            {
                ...damageAbility,
                trigger: { event: "stepStarted", when: { kind: "stepStarted", step: "upkeep" } },
            },
        ]);
        const secondWatcher = creature("second-watcher", [
            {
                ...damageAbility,
                trigger: { event: "stepStarted", when: { kind: "stepStarted", step: "upkeep" } },
            },
        ]);
        let state = game([firstWatcher, secondWatcher]);
        state = moveDefinition(state, alice, firstWatcher, "battlefield").state;
        state = moveDefinition(state, alice, secondWatcher, "battlefield").state;

        const result = detectTriggers(state, [{ type: "stepStarted", step: "upkeep", activePlayer: alice }]);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.state.pendingTriggers[alice]).toHaveLength(2);
        expect(result.state.pendingTriggers[alice]?.map((trigger) => trigger.ability)).toEqual([firstWatcher.abilities[0], secondWatcher.abilities[0]]);
    });
});

describe("trigger placement", () => {
    test("puts a single untargeted trigger on the stack and gives priority to the expected player", () => {
        const watcher = creature("single-trigger", [lifeChangedAbility()]);
        const permanent = moveDefinition(game([watcher]), alice, watcher, "battlefield");
        const detected = detectLifeChangedTriggers(permanent.state);
        expect(detected.ok).toBe(true);
        if (!detected.ok) return;

        const result = grantPriority({ ...detected.state, pending: null }, [], bob, 0);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.state.stack).toHaveLength(1);
        expect(result.state.priority?.holder).toBe(bob);
        expect(result.state.pending).toMatchObject({ kind: "priority", player: bob });
    });

    test("places the active player's trigger first so the non-active player's trigger resolves first", () => {
        const aliceWatcher = creature("alice-trigger", [lifeChangedAbility()]);
        const bobWatcher = creature("bob-trigger", [lifeChangedAbility()]);
        let state = game([aliceWatcher, bobWatcher], [aliceWatcher], [bobWatcher]);
        const alicePermanent = moveDefinition(state, alice, aliceWatcher, "battlefield");
        state = alicePermanent.state;
        const bobPermanent = moveDefinition(state, bob, bobWatcher, "battlefield");
        state = bobPermanent.state;

        const detected = detectLifeChangedTriggers(state);
        expect(detected.ok).toBe(true);
        if (!detected.ok) return;
        const placed = placePendingTriggers(detected.state, []);

        expect(placed.ok).toBe(true);
        if (!placed.ok) return;
        expect(placed.state.stack.map((entry) => entry.controller)).toEqual([alice, bob]);
        expect(placed.state.stack.at(-1)?.controller).toBe(bob);
    });

    test("uses the chosen order for two triggers controlled by one player", () => {
        const firstWatcher = creature("ordered-first", [lifeChangedAbility()]);
        const secondWatcher = creature("ordered-second", [lifeChangedAbility()]);
        let state = game([firstWatcher, secondWatcher]);
        const first = moveDefinition(state, alice, firstWatcher, "battlefield");
        state = first.state;
        const second = moveDefinition(state, alice, secondWatcher, "battlefield");
        state = second.state;

        const detected = detectLifeChangedTriggers(state);
        expect(detected.ok).toBe(true);
        if (!detected.ok) return;
        const ordering = placePendingTriggers(detected.state, []);

        expect(ordering.ok).toBe(true);
        if (!ordering.ok) return;
        expect(ordering.state.pending).toMatchObject({ kind: "order", player: alice });
        if (ordering.state.pending?.kind !== "order") return;
        expect(ordering.state.pending.options).toHaveLength(2);

        const placed = submitAnswer(ordering.state, {
            player: alice,
            decision: ordering.state.pending.id,
            answer: { kind: "order", order: [1, 0] },
        });

        expect(placed.ok).toBe(true);
        if (!placed.ok) return;
        expect(placed.state.stack.map((entry) => entry.source)).toEqual([second.newId, first.newId]);
        expect(placed.state.stack.at(-1)?.source).toBe(first.newId);
    });

    test("does not ask for ordering when there is only one trigger", () => {
        const watcher = creature("one-trigger", [lifeChangedAbility()]);
        const permanent = moveDefinition(game([watcher]), alice, watcher, "battlefield");
        const detected = detectLifeChangedTriggers(permanent.state);
        expect(detected.ok).toBe(true);
        if (!detected.ok) return;

        const placed = placePendingTriggers(detected.state, []);

        expect(placed.ok).toBe(true);
        if (!placed.ok) return;
        expect(placed.state.pending?.kind).not.toBe("order");
        expect(placed.state.stack).toHaveLength(1);
    });

    test("asks for and records a target for a targeted trigger", () => {
        const targetedAbility: AbilityOfKind<"triggered"> = {
            ...lifeChangedAbility(),
            targets: [{
                filter: { kind: "player", filter: { kind: "anyPlayer" } },
                minCount: 1,
                maxCount: 1,
                description: "player",
            }],
        };
        const watcher = creature("targeted-trigger", [targetedAbility]);
        const permanent = moveDefinition(game([watcher]), alice, watcher, "battlefield");
        const detected = detectLifeChangedTriggers(permanent.state);
        expect(detected.ok).toBe(true);
        if (!detected.ok) return;
        const targeting = placePendingTriggers(detected.state, []);

        expect(targeting.ok).toBe(true);
        if (!targeting.ok) return;
        expect(targeting.state.pending).toMatchObject({ kind: "choose", player: alice, min: 1, max: 1 });
        if (targeting.state.pending?.kind !== "choose") return;
        const bobOption = targeting.state.pending.options.find((option) => option.value.kind === "player" && option.value.id === bob);
        expect(bobOption).toBeDefined();
        if (!bobOption) return;

        const placed = submitAnswer(targeting.state, {
            player: alice,
            decision: targeting.state.pending.id,
            answer: { kind: "choose", selected: [bobOption.id] },
        });

        if (!placed.ok) throw new Error(placed.error);
        const triggerEntry = placed.state.stack.at(-1);
        expect(triggerEntry?.kind).toBe("ability");
        if (triggerEntry?.kind !== "ability") return;
        expect(triggerEntry.targets).toEqual([[{ kind: "player", id: bob }]]);
        expect(placed.state.placingTriggers).toBeNull();
        expect(placed.state.pending).toMatchObject({ kind: "priority", player: alice });
        expect(placed.state.pending?.id).not.toBe(targeting.state.pending.id);
    });

    test("does not put a targeted trigger on the stack when there is no legal target", () => {
        const targetedAbility: AbilityOfKind<"triggered"> = {
            ...lifeChangedAbility(),
            targets: [{
                filter: { kind: "object", filter: { kind: "hasType", type: "Artifact" } },
                minCount: 1,
                maxCount: 1,
                description: "artifact",
            }],
        };
        const watcher = creature("no-legal-target", [targetedAbility]);
        const permanent = moveDefinition(game([watcher]), alice, watcher, "battlefield");
        const detected = detectLifeChangedTriggers(permanent.state);
        expect(detected.ok).toBe(true);
        if (!detected.ok) return;

        const placed = placePendingTriggers(detected.state, []);

        expect(placed.ok).toBe(true);
        if (!placed.ok) return;
        expect(placed.state.pending?.kind).not.toBe("order");
        expect(placed.state.stack).toHaveLength(0);
        expect(placed.events.some((event) => event.type === "abilityTriggered")).toBe(false);
    });

    test("runs SBAs in the trigger checkpoint and places triggers they generate", () => {
        const aliceWatcher = creature("already-triggered", [lifeChangedAbility()]);
        const bobWatcher = creature("dies-during-checkpoint", [diesAbility]);
        let state = game([aliceWatcher, bobWatcher], [aliceWatcher], [bobWatcher]);
        const alicePermanent = moveDefinition(state, alice, aliceWatcher, "battlefield");
        state = alicePermanent.state;
        const bobPermanent = moveDefinition(state, bob, bobWatcher, "battlefield");
        state = {
            ...bobPermanent.state,
            pending: null,
            objects: {
                ...bobPermanent.state.objects,
                [bobPermanent.newId]: { ...bobPermanent.state.objects[bobPermanent.newId]!, damage: 2 },
            },
        };
        const detected = detectLifeChangedTriggers(state);
        expect(detected.ok).toBe(true);
        if (!detected.ok) return;

        const result = grantPriority({ ...detected.state, pending: null }, [], alice, 0);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.state.objects[bobPermanent.newId]).toBeUndefined();
        expect(result.state.stack.filter((entry) => entry.kind === "ability" && entry.ability.kind === "triggered")).toHaveLength(2);
        expect(result.state.pendingTriggers).toEqual({});
    });
});
