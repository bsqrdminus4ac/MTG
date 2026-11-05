import { describe, expect, test } from "vitest";
import { applyAction, submitAnswer } from "../../src/engine";
import type { AbilityOfKind } from "../../src/model/abilities";
import type { CardDefinition } from "../../src/model/cardDefinition";
import { snapshotSource } from "../../src/model/characteristics";
import { type TargetSpec } from "../../src/model/effects";
import { cardDefId, playerId, type ObjectId, type StackId } from "../../src/model/ids";
import type { Bindings, GameState, Target } from "../../src/model/state";
import { moveObject } from "../../src/model/zones";
import { createGame } from "../../src/setup";
import { beginResolution } from "../../src/flow/resolution";
import { detectTriggers } from "../../src/rules/triggers";
import { placePendingTriggers } from "../../src/flow/triggers";

const alice = playerId("alice");
const bob = playerId("bob");

const bear: CardDefinition = {
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

const targetSpecs: TargetSpec[] = [
    { filter: { kind: "player", filter: { kind: "opponent" } }, minCount: 1, maxCount: 1 },
    {
        filter: {
            kind: "object",
            filter: {
                kind: "all",
                of: [
                    { kind: "inZone", zone: "battlefield" },
                    { kind: "hasType", type: "Creature" },
                ],
            },
        },
        minCount: 1,
        maxCount: 1,
    },
];

const targetSpellAbility: AbilityOfKind<"spell"> = {
    kind: "spell",
    targets: targetSpecs,
    effects: [
        { kind: "gainLife", who: { kind: "target", spec: 0 }, amount: 3 },
        { kind: "destroy", target: { kind: "target", spec: 1 } },
    ],
};

const targetSpell: CardDefinition = {
    id: cardDefId("target-spell"),
    name: "Target Spell",
    manaCost: { generic: 0, pips: [] },
    colors: [],
    supertypes: [],
    types: ["Instant"],
    subtypes: [],
    power: null,
    toughness: null,
    abilities: [targetSpellAbility],
};

function stateWithSpellOnStack(): {
    state: GameState;
    spell: ObjectId;
    creature: ObjectId;
    targets: readonly (readonly Target[])[];
} {
    const initial = createGame(
        [bear, targetSpell],
        [
            { id: alice, deck: [targetSpell.id, bear.id] },
            { id: bob, deck: [bear.id] },
        ],
    );
    const aliceCreature = moveObject(initial, initial.players[alice]!.library[1]!, "battlefield")!;
    const bobCreature = moveObject(aliceCreature.state, aliceCreature.state.players[bob]!.library[0]!, "battlefield")!;
    const movedSpell = moveObject(bobCreature.state, bobCreature.state.players[alice]!.library[0]!, "stack")!;
    const targets: readonly (readonly Target[])[] = [[{ kind: "player", id: bob }], [{ kind: "object", id: bobCreature.newId }]];

    return {
        state: {
            ...movedSpell.state,
            stack: [
                {
                    kind: "spell",
                    id: movedSpell.state.nextId as StackId,
                    controller: alice,
                    source: movedSpell.newId,
                    targets,
                    ability: targetSpellAbility,
                    bindings: {},
                },
            ],
            priority: null,
        },
        spell: movedSpell.newId,
        creature: bobCreature.newId,
        targets,
    };
}

function mustResolve(state: GameState) {
    const result = beginResolution(state);
    if (!result.ok) throw new Error(result.error);
    return result;
}

function putTriggeredAbilityOnStack(
    state: GameState,
    source: ObjectId,
    ability: AbilityOfKind<"triggered">,
    sourceSnapshot = snapshotSource(state, source),
    bindings: Bindings = {},
    targets: readonly (readonly Target[])[] = [],
): GameState {
    if (!sourceSnapshot) throw new Error("Expected source snapshot");
    const entryId = state.nextId as StackId;
    return {
        ...state,
        stack: [{
            kind: "ability",
            id: entryId,
            controller: alice,
            source,
            targets,
            bindings,
            ability,
            sourceSnapshot,
        }],
        priority: null,
    };
}

describe("ability resolution", () => {
    test("resolves after its source leaves the battlefield using the source snapshot name", () => {
        const initial = createGame(
            [bear],
            [
                { id: alice, deck: [bear.id] },
                { id: bob, deck: [bear.id] },
            ],
        );
        const source = moveObject(initial, initial.players[alice]!.library[0]!, "battlefield")!;
        const sourceSnapshot = snapshotSource(source.state, source.newId);
        if (!sourceSnapshot) throw new Error("Expected source snapshot");

        const ability: AbilityOfKind<"activated"> = {
            kind: "activated",
            cost: {},
            isManaAbility: false,
            targets: [],
            effects: [{ kind: "gainLife", who: { kind: "player", who: "controller" }, amount: 1 }],
            activateableZones: ["battlefield"],
            timingRestriction: "instantSpeed",
        };
        const entryId = source.state.nextId as StackId;
        const sourceLeft = moveObject(source.state, source.newId, "graveyard")!;
        const state: GameState = {
            ...sourceLeft.state,
            stack: [
                {
                    kind: "ability",
                    id: entryId,
                    controller: alice,
                    source: source.newId,
                    targets: [],
                    bindings: {},
                    ability,
                    sourceSnapshot,
                },
            ],
            priority: null,
        };

        const result = mustResolve(state);

        expect(state.objects[source.newId]).toBeUndefined();
        expect(state.players[alice]?.graveyard).toContain(sourceLeft.newId);
        expect(result.state.players[alice]?.life).toBe(21);
        expect(result.events).toContainEqual({ type: "lifeChanged", player: alice, delta: 1 });
        expect(result.events).toContainEqual({
            type: "stackEntryResolved",
            id: entryId,
            entryName: "Grizzly Bears's ability",
        });
    });

    test("fizzles when its intervening-if condition becomes false before resolution", () => {
        const initial = createGame([bear], [{ id: alice, deck: [bear.id] }, { id: bob, deck: [] }]);
        const source = moveObject(initial, initial.players[alice]!.library[0]!, "battlefield");
        if (!source) throw new Error("Unable to move the source to the battlefield");
        const ability: AbilityOfKind<"triggered"> = {
            kind: "triggered",
            trigger: {
                event: "lifeChanged",
                when: { kind: "lifeChanged" },
                interveningIf: { kind: "flag", name: "stillValid" },
            },
            targets: [],
            effects: [{ kind: "gainLife", who: { kind: "player", who: "controller" }, amount: 5 }],
            triggerableZones: ["battlefield"],
        };
        const triggered = putTriggeredAbilityOnStack(source.state, source.newId, ability, undefined, { stillValid: true });
        const responseChangedCondition: GameState = {
            ...triggered,
            stack: [{ ...triggered.stack[0]!, bindings: { stillValid: false } }],
        };

        const result = mustResolve(responseChangedCondition);

        expect(result.state.players[alice]?.life).toBe(20);
        expect(result.events).toContainEqual(expect.objectContaining({
            type: "stackEntryFizzles",
            reason: "interveningIf",
        }));
        expect(result.events).not.toContainEqual(expect.objectContaining({ type: "stackEntryResolved" }));
    });

    test("resolves a dies trigger from its source snapshot after the source is gone", () => {
        const ability: AbilityOfKind<"triggered"> = {
            kind: "triggered",
            trigger: {
                event: "cardMoved",
                when: { kind: "cardMoved", from: "battlefield", to: "graveyard", object: { kind: "isSource" } },
            },
            targets: [],
            effects: [{ kind: "damage", to: { kind: "player", who: "eachOpponent" }, amount: 1 }],
            triggerableZones: ["battlefield"],
        };
        const diesCard: CardDefinition = { ...bear, abilities: [ability] };
        const initial = createGame([diesCard], [{ id: alice, deck: [diesCard.id] }, { id: bob, deck: [] }]);
        const source = moveObject(initial, initial.players[alice]!.library[0]!, "battlefield")!;
        const died = moveObject(source.state, source.newId, "graveyard")!;
        const detected = detectTriggers(died.state, died.events);
        if (!detected.ok) throw new Error(detected.error);
        const placed = placePendingTriggers(detected.state, detected.events);
        if (!placed.ok) throw new Error(placed.error);

        const result = mustResolve(placed.state);

        expect(result.state.objects[source.newId]).toBeUndefined();
        expect(result.state.players[alice]?.graveyard).toContain(died.newId);
        expect(result.state.players[bob]?.life).toBe(19);
        expect(result.events).toContainEqual(expect.objectContaining({
            type: "damageDealt",
            sourceLki: expect.objectContaining({ id: source.newId, chars: expect.objectContaining({ power: 2 }) }),
        }));
    });

    test("uses event.amount from the triggering damage event", () => {
        const ability: AbilityOfKind<"triggered"> = {
            kind: "triggered",
            trigger: { event: "damageDealt", when: { kind: "damageDealt" } },
            targets: [],
            effects: [{ kind: "gainLife", who: { kind: "player", who: "controller" }, amount: { kind: "bound", name: "event.amount" } }],
            triggerableZones: ["battlefield"],
        };
        const watcher: CardDefinition = { ...bear, id: cardDefId("damage-drawer"), abilities: [ability] };
        const initial = createGame([watcher], [{ id: alice, deck: [watcher.id] }, { id: bob, deck: [] }]);
        const source = moveObject(initial, initial.players[alice]!.library[0]!, "battlefield")!;
        const sourceSnapshot = snapshotSource(source.state, source.newId);
        if (!sourceSnapshot) throw new Error("Expected source snapshot");
        const detected = detectTriggers(source.state, [{
            type: "damageDealt",
            source: source.newId,
            sourceLki: sourceSnapshot,
            target: { kind: "player", id: bob },
            targetName: "bob",
            amount: 4,
            isCombatDamage: false,
        }]);
        if (!detected.ok) throw new Error(detected.error);
        const placed = placePendingTriggers(detected.state, detected.events);
        if (!placed.ok) throw new Error(placed.error);

        const result = mustResolve(placed.state);

        expect(result.state.players[alice]?.life).toBe(24);
    });

    test("uses the new object id from a zone-change event when targeting the moved card", () => {
        const returnAbility: AbilityOfKind<"triggered"> = {
            kind: "triggered",
            trigger: {
                event: "cardMoved",
                when: { kind: "cardMoved", from: "battlefield", to: "graveyard" },
            },
            targets: [{
                filter: { kind: "object", filter: { kind: "all", of: [
                    { kind: "inZone", zone: "graveyard" },
                    { kind: "hasType", type: "Creature" },
                ] } },
                minCount: 1,
                maxCount: 1,
            }],
            effects: [],
            triggerableZones: ["battlefield"],
        };
        const watcher: CardDefinition = { ...bear, id: cardDefId("return-watcher"), abilities: [returnAbility] };
        const movedCard: CardDefinition = { ...bear, id: cardDefId("moved-card") };
        const initial = createGame(
            [watcher, movedCard],
            [{ id: alice, deck: [watcher.id, movedCard.id] }, { id: bob, deck: [] }],
        );
        const watcherOnField = moveObject(initial, initial.players[alice]!.library[0]!, "battlefield")!;
        const cardOnField = moveObject(watcherOnField.state, watcherOnField.state.players[alice]!.library[0]!, "battlefield")!;
        const died = moveObject(cardOnField.state, cardOnField.newId, "graveyard")!;
        const detected = detectTriggers(died.state, died.events);
        if (!detected.ok) throw new Error(detected.error);
        const targeting = placePendingTriggers(detected.state, detected.events);
        if (!targeting.ok) throw new Error(targeting.error);
        if (targeting.state.pending?.kind !== "choose") throw new Error("Expected the trigger target choice");

        expect(targeting.state.pending.options.map((option) => option.value)).toContainEqual({ kind: "object", id: died.newId });
        expect(targeting.state.pending.options.map((option) => option.value)).not.toContainEqual({ kind: "object", id: cardOnField.newId });
        const selected = submitAnswer(targeting.state, {
            player: alice,
            decision: targeting.state.pending.id,
            answer: { kind: "choose", selected: [`object:${died.newId}`] },
        });
        if (!selected.ok) throw new Error(selected.error);
        const triggerEntry = selected.state.stack.at(-1);
        if (triggerEntry?.kind !== "ability") throw new Error("Expected the trigger on the stack");

        expect(triggerEntry.targets).toEqual([[{ kind: "object", id: died.newId }]]);
        expect(triggerEntry.bindings["event.object"]).toEqual([{ kind: "object", id: died.newId }]);
    });

    test("pauses for a may-draw decision, drawing only when the answer is yes", () => {
        const mayDraw: AbilityOfKind<"triggered"> = {
            kind: "triggered",
            trigger: { event: "lifeChanged", when: { kind: "lifeChanged" } },
            targets: [],
            effects: [
                { kind: "askYesNo", who: { kind: "player", who: "controller" }, prompt: "Draw a card?", bindAs: "mayDraw" },
                { kind: "if", condition: { kind: "flag", name: "mayDraw" }, then: [
                    { kind: "draw", who: { kind: "player", who: "controller" }, count: 1 },
                ] },
            ],
            triggerableZones: ["battlefield"],
        };
        const yesInitial = createGame([bear], [{ id: alice, deck: [bear.id, bear.id] }, { id: bob, deck: [] }]);
        const yesSource = moveObject(yesInitial, yesInitial.players[alice]!.library[0]!, "battlefield")!;
        const yesPaused = mustResolve(putTriggeredAbilityOnStack(yesSource.state, yesSource.newId, mayDraw));
        if (yesPaused.state.pending?.kind !== "yesNo") throw new Error("Expected a yes/no decision");
        const yesResult = submitAnswer(yesPaused.state, {
            player: alice,
            decision: yesPaused.state.pending.id,
            answer: { kind: "yesNo", value: true },
        });
        if (!yesResult.ok) throw new Error(yesResult.error);

        const noInitial = createGame([bear], [{ id: alice, deck: [bear.id, bear.id] }, { id: bob, deck: [] }]);
        const noSource = moveObject(noInitial, noInitial.players[alice]!.library[0]!, "battlefield")!;
        const noPaused = mustResolve(putTriggeredAbilityOnStack(noSource.state, noSource.newId, mayDraw));
        if (noPaused.state.pending?.kind !== "yesNo") throw new Error("Expected a yes/no decision");
        const noResult = submitAnswer(noPaused.state, {
            player: alice,
            decision: noPaused.state.pending.id,
            answer: { kind: "yesNo", value: false },
        });
        if (!noResult.ok) throw new Error(noResult.error);

        expect(yesResult.state.players[alice]?.hand).toHaveLength(1);
        expect(yesResult.state.players[alice]?.library).toHaveLength(0);
        expect(noResult.state.players[alice]?.hand).toHaveLength(0);
        expect(noResult.state.players[alice]?.library).toHaveLength(1);
    });

    test("fizzles when a targeted trigger's target is removed in response", () => {
        const targeted: AbilityOfKind<"triggered"> = {
            kind: "triggered",
            trigger: { event: "lifeChanged", when: { kind: "lifeChanged" } },
            targets: [{
                filter: { kind: "object", filter: { kind: "all", of: [
                    { kind: "inZone", zone: "battlefield" },
                    { kind: "hasType", type: "Creature" },
                ] } },
                minCount: 1,
                maxCount: 1,
            }],
            effects: [{ kind: "destroy", target: { kind: "target", spec: 0 } }],
            triggerableZones: ["battlefield"],
        };
        const initial = createGame([bear], [{ id: alice, deck: [bear.id, bear.id] }, { id: bob, deck: [] }]);
        const source = moveObject(initial, initial.players[alice]!.library[0]!, "battlefield")!;
        const target = moveObject(source.state, source.state.players[alice]!.library[0]!, "battlefield")!;
        const stackState = putTriggeredAbilityOnStack(target.state, source.newId, targeted, undefined, {}, [[{ kind: "object", id: target.newId }]]);
        const responded = moveObject(stackState, target.newId, "graveyard")!;

        const result = mustResolve(responded.state);

        expect(result.events).toContainEqual(expect.objectContaining({
            type: "stackEntryFizzles",
            reason: "lackOfTargets",
        }));
        expect(result.events).not.toContainEqual(expect.objectContaining({ type: "stackEntryResolved" }));
        expect(result.state.objects[target.newId]).toBeUndefined();
    });

    test("places a trigger caused by the resolving trigger's damage after it resolves", () => {
        const firstAbility: AbilityOfKind<"triggered"> = {
            kind: "triggered",
            trigger: { event: "lifeChanged", when: { kind: "lifeChanged" } },
            targets: [],
            effects: [{ kind: "damage", to: { kind: "player", who: "eachOpponent" }, amount: 1 }],
            triggerableZones: ["battlefield"],
        };
        const secondAbility: AbilityOfKind<"triggered"> = {
            kind: "triggered",
            trigger: { event: "damageDealt", when: { kind: "damageDealt" } },
            targets: [],
            effects: [{ kind: "gainLife", who: { kind: "player", who: "controller" }, amount: 2 }],
            triggerableZones: ["battlefield"],
        };
        const firstWatcher: CardDefinition = { ...bear, id: cardDefId("first-watcher"), abilities: [firstAbility] };
        const secondWatcher: CardDefinition = { ...bear, id: cardDefId("second-watcher"), abilities: [secondAbility] };
        const initial = createGame(
            [firstWatcher, secondWatcher],
            [{ id: alice, deck: [firstWatcher.id, secondWatcher.id] }, { id: bob, deck: [] }],
        );
        const first = moveObject(initial, initial.players[alice]!.library[0]!, "battlefield")!;
        const second = moveObject(first.state, first.state.players[alice]!.library[0]!, "battlefield")!;
        const detected = detectTriggers(second.state, [{ type: "lifeChanged", player: bob, delta: -1 }]);
        if (!detected.ok) throw new Error(detected.error);
        const placed = placePendingTriggers(detected.state, detected.events);
        if (!placed.ok) throw new Error(placed.error);
        const firstEntry = placed.state.stack.at(-1);
        if (firstEntry?.kind !== "ability") throw new Error("Expected the first trigger on the stack");

        const result = mustResolve(placed.state);
        const secondEntry = result.state.stack.at(-1);

        expect(result.state.players[bob]?.life).toBe(19);
        expect(secondEntry?.kind).toBe("ability");
        if (secondEntry?.kind !== "ability") return;
        expect(secondEntry.ability).toEqual(secondAbility);
        expect(result.events.findIndex((event) => event.type === "stackEntryResolved" && event.id === firstEntry.id))
            .toBeLessThan(result.events.findIndex((event) => event.type === "abilityTriggered" && event.abilitySourceLki.id === second.newId));
    });
});

describe("spell resolution with multiple target specs", () => {
    test("casting stores choices separately for each target spec", () => {
        const initial = createGame([bear, targetSpell], [
            { id: alice, deck: [targetSpell.id, bear.id] },
            { id: bob, deck: [bear.id] },
        ]);
        const aliceBear = moveObject(initial, initial.players[alice]!.library[1]!, "battlefield")!;
        const bobBear = moveObject(aliceBear.state, aliceBear.state.players[bob]!.library[0]!, "battlefield")!;
        const inHand = moveObject(bobBear.state, bobBear.state.players[alice]!.library[0]!, "hand")!;
        const startCast = applyAction(inHand.state, {
            type: "castSpell",
            player: alice,
            card: inHand.newId,
        });
        if (!startCast.ok || startCast.state.pending?.kind !== "choose") {
            throw new Error("Expected the first target choice");
        }
        expect(startCast.state.pending.options.map((option) => option.id)).toContain(`player:${bob}`);

        const selectFirst = submitAnswer(startCast.state, {
            player: alice,
            decision: startCast.state.pending.id,
            answer: { kind: "choose", selected: [`player:${bob}`] },
        });
        if (!selectFirst.ok || selectFirst.state.pending?.kind !== "choose") {
            throw new Error("Expected the second target choice");
        }
        expect(selectFirst.state.casting?.targets).toEqual([[{ kind: "player", id: bob }]]);
        expect(selectFirst.state.pending.options.map((option) => option.id)).toContain(`object:${bobBear.newId}`);

        const selectSecond = submitAnswer(selectFirst.state, {
            player: alice,
            decision: selectFirst.state.pending.id,
            answer: { kind: "choose", selected: [`object:${bobBear.newId}`] },
        });
        if (!selectSecond.ok || selectSecond.state.pending?.kind !== "yesNo") {
            throw new Error("Expected the spell payment decision");
        }
        expect(selectSecond.state.casting?.targets).toEqual([
            [{ kind: "player", id: bob }],
            [{ kind: "object", id: bobBear.newId }],
        ]);

        const committed = submitAnswer(selectSecond.state, {
            player: alice,
            decision: selectSecond.state.pending.id,
            answer: { kind: "yesNo", value: true },
        });
        if (!committed.ok) throw new Error(committed.error);
        expect(committed.state.stack[0]?.targets).toEqual([
            [{ kind: "player", id: bob }],
            [{ kind: "object", id: bobBear.newId }],
        ]);
    });

    test("resolves each effect against the target group for its spec", () => {
        const fixture = stateWithSpellOnStack();
        const result = mustResolve(fixture.state);

        expect(result.state.players[bob]?.life).toBe(23);
        expect(result.state.objects[fixture.creature]).toBeUndefined();
        expect(result.state.players[bob]?.graveyard).toHaveLength(1);
        expect(result.state.objects[fixture.spell]).toBeUndefined();
        expect(result.state.players[alice]?.graveyard).toHaveLength(1);
        expect(result.events).toContainEqual({
            type: "stackEntryResolved",
            id: fixture.state.stack[0]!.id,
            entryName: "Target Spell",
        });
        expect(result.events).not.toContainEqual(expect.objectContaining({ type: "stackEntryFizzles" }));
    });

    test("does not fizzle when one target spec remains legal", () => {
        const fixture = stateWithSpellOnStack();
        const movedCreature = moveObject(fixture.state, fixture.creature, "graveyard")!;
        const targets: readonly (readonly Target[])[] = [fixture.targets[0]!, [{ kind: "object", id: fixture.creature }]];
        const state: GameState = {
            ...movedCreature.state,
            stack: [{
                ...fixture.state.stack[0]!,
                targets,
            }],
        };
        const result = mustResolve(state);

        expect(result.state.players[bob]?.life).toBe(23);
        expect(result.state.players[alice]?.graveyard).toHaveLength(1);
        expect(result.events).not.toContainEqual(expect.objectContaining({ type: "stackEntryFizzles" }));
        expect(result.events).toContainEqual(expect.objectContaining({ type: "stackEntryResolved" }));
    });

    test("fizzles when targets in every spec are illegal", () => {
        const fixture = stateWithSpellOnStack();
        const movedCreature = moveObject(fixture.state, fixture.creature, "graveyard")!;
        const targets: readonly (readonly Target[])[] = [
            [{ kind: "player", id: alice }],
            [{ kind: "object", id: fixture.creature }],
        ];
        const state: GameState = {
            ...movedCreature.state,
            stack: [{
                ...fixture.state.stack[0]!,
                targets,
            }],
        };
        const result = mustResolve(state);

        expect(result.state.players[bob]?.life).toBe(20);
        expect(result.state.resolving).toBeNull();
        expect(result.state.stack).toHaveLength(0);
        expect(result.state.players[alice]?.graveyard).toHaveLength(1);
        expect(result.state.objects[fixture.spell]).toBeUndefined();
        expect(result.events).toContainEqual({
            type: "stackEntryFizzles",
            id: fixture.state.stack[0]!.id,
            entryName: "Target Spell",
            reason: "lackOfTargets",
        });
        expect(result.events).not.toContainEqual(expect.objectContaining({ type: "stackEntryResolved" }));
    });
});
