import { describe, expect, test } from "vitest";
import { applyAction, submitAnswer } from "../engine";
import type { AbilityOfKind } from "../model/abilities";
import type { CardDefinition } from "../model/cardDefinition";
import { getCharacteristics } from "../model/characteristics";
import { type TargetSpec } from "../model/effects";
import { cardDefId, playerId, type ObjectId, type StackId } from "../model/ids";
import type { GameState, SourceSnapshot, Target } from "../model/state";
import { moveObject } from "../model/zones";
import { createGame } from "../setup";
import { beginResolution } from "./resolution";

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
    abilities: [
        {
            kind: "spell",
            targets: targetSpecs,
            effects: [
                { kind: "gainLife", who: { kind: "target", spec: 0 }, amount: 3 },
                { kind: "destroy", target: { kind: "target", spec: 1 } },
            ],
        },
    ],
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
        const sourceObject = source.state.objects[source.newId]!;
        const sourceCharacteristics = getCharacteristics(source.state, source.newId);
        if (!sourceCharacteristics) throw new Error("Expected source characteristics");

        const ability: AbilityOfKind<"activated"> = {
            kind: "activated",
            cost: { mana: null, tap: false, sacrificeSelf: false },
            isManaAbility: false,
            targets: [],
            effects: [{ kind: "gainLife", who: { kind: "player", who: "controller" }, amount: 1 }],
            activateableZones: ["battlefield"],
            timingRestriction: "instantSpeed",
        };
        const sourceSnapshot: SourceSnapshot = {
            id: source.newId,
            chars: sourceCharacteristics,
            controller: sourceObject.controller,
            owner: sourceObject.owner,
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
            targets: [],
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
        });
        expect(result.events).not.toContainEqual(expect.objectContaining({ type: "stackEntryResolved" }));
    });
});
