import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/rules/triggers", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/rules/triggers")>();
    return {
        ...actual,
        detectTriggers: vi.fn(actual.detectTriggers),
    };
});

import { submitAnswer, applyAction } from "../../src/engine";
import type { AbilityOfKind } from "../../src/model/abilities";
import type { CardDefinition } from "../../src/model/cardDefinition";
import { snapshotSource } from "../../src/model/characteristics";
import { cardDefId, playerId, type ObjectId, type StackId } from "../../src/model/ids";
import type { GameState, Target } from "../../src/model/state";
import { moveObject } from "../../src/model/zones";
import { createGame } from "../../src/setup";
import { detectTriggers } from "../../src/rules/triggers";
import { runResolution } from "../../src/flow/resolution";

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

function game(definitions: readonly CardDefinition[], aliceDeck: readonly CardDefinition[] = definitions): GameState {
    return createGame(
        definitions,
        [
            { id: alice, deck: aliceDeck.map((definition) => definition.id) },
            { id: bob, deck: [] },
        ],
    );
}

function moveDefinition(state: GameState, player: typeof alice | typeof bob, definition: CardDefinition, zone: "hand" | "battlefield" | "graveyard") {
    const card = state.players[player]?.library.find((id) => state.objects[id]?.definitionId === definition.id);
    if (card === undefined) throw new Error(`Missing ${definition.name} in ${player}'s library`);
    const moved = moveObject(state, card, zone);
    if (!moved) throw new Error(`Unable to move ${definition.name}`);
    return moved;
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
        expect(entering.state.pendingTriggers).toHaveLength(1);
        expect(entering.state.pendingTriggers[0]?.event).toEqual(entered.events[0]);
        expect(entered.events[0]?.type === "cardMoved" ? entered.events[0].after : undefined).toEqual(entering.state.pendingTriggers[0]?.lki);

        const died = moveObject(entered.state, entered.newId, "graveyard");
        if (!died) throw new Error("Unable to move the permanent to the graveyard");
        const leaving = detectTriggers(died.state, died.events);
        expect(leaving.ok).toBe(true);
        if (!leaving.ok) return;
        expect(leaving.state.pendingTriggers).toHaveLength(0);
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
        expect(result.state.pendingTriggers).toHaveLength(1);
        expect(result.state.pendingTriggers[0]?.lki).toEqual(died.events[0]?.type === "cardMoved" ? died.events[0].before : undefined);
        expect(result.state.pendingTriggers[0]?.lki?.zone).toBe("battlefield");
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
        expect(result.state.pendingTriggers).toHaveLength(0);
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
        expect(result.state.pendingTriggers).toHaveLength(0);
    });

    test("keeps a damage trigger exactly once when resolution pauses for a decision", () => {
        const watcher = creature("damage-watcher", [damageAbility]);
        const sourceCard = creature("damage-source");
        const initial = game([watcher, sourceCard]);
        const sourceOnBattlefield = moveDefinition(initial, alice, watcher, "battlefield");
        const source = sourceOnBattlefield.state.players[alice]?.library.find(
            (id) => sourceOnBattlefield.state.objects[id]?.definitionId === sourceCard.id,
        );
        if (source === undefined) throw new Error("Missing resolving source");
        const sourceLki = snapshotSource(sourceOnBattlefield.state, source);
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
        expect(paused.state.pendingTriggers).toHaveLength(1);
        expect(triggerSpy.mock.calls.flatMap(([, events]) => events).filter((event) => event.type === "damageDealt")).toHaveLength(1);

        if (paused.state.pending?.kind !== "yesNo") return;
        const resumed = submitAnswer(paused.state, {
            player: alice,
            decision: paused.state.pending.id,
            answer: { kind: "yesNo", value: true },
        });

        expect(resumed.ok).toBe(true);
        if (!resumed.ok) return;
        expect(resumed.state.pendingTriggers).toHaveLength(1);
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
        expect(result.state.pendingTriggers).toHaveLength(2);
        expect(result.state.pendingTriggers.map((trigger) => trigger.ability)).toEqual([
            firstWatcher.abilities[0],
            secondWatcher.abilities[0],
        ]);
    });
});
