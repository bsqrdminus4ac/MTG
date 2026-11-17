import { describe, expect, test } from "vitest";
import { submitAnswer } from "../../src/engine";
import { beginCombat, beginDeclareBlockers, processCombatDamage, startCombatDamage } from "../../src/flow/combat";
import { beginResolution } from "../../src/flow/resolution";
import type { CardDefinition } from "../../src/model/cardDefinition";
import { hasKeyword, snapshotObject } from "../../src/model/characteristics";
import type { GameEvent } from "../../src/model/events";
import { cardDefId, nextID, playerId, type ObjectId, type StackId } from "../../src/model/ids";
import type { GameState } from "../../src/model/state";
import { moveObject } from "../../src/model/zones";
import { createGame } from "../../src/setup";
import { makeContinuousEffect } from "../helpers";

const alice = playerId("alice");
const bob = playerId("bob");

const creature = (id: string, power: number, toughness: number, abilities: CardDefinition["abilities"] = []): CardDefinition => ({
    id: cardDefId(id),
    name: id,
    cost: [{ kind: "mana", cost: { generic: 0, pips: [] } }],
    colors: [],
    supertypes: [],
    types: ["Creature"],
    subtypes: [],
    power,
    toughness,
    abilities,
});

function mustMoveToBattlefield(state: GameState, id: ObjectId) {
    const moved = moveObject(state, id, "battlefield");
    if (moved === null) throw new Error(`Could not move object ${id} to battlefield`);
    return moved;
}

function damageSummary(events: readonly GameEvent[]) {
    return events.filter((event): event is Extract<GameEvent, { type: "damageDealt" }> => event.type === "damageDealt").map((event) => [event.target, event.amount, event.isCombatDamage] as const);
}

function combatState(
    attackerDefinition: CardDefinition,
    blockerDefinitions: readonly CardDefinition[] = [],
): { readonly state: GameState; readonly attacker: ObjectId; readonly blockers: readonly ObjectId[] } {
    const initial = createGame(
        [attackerDefinition, ...blockerDefinitions],
        [
            { id: alice, deck: [attackerDefinition.id] },
            { id: bob, deck: blockerDefinitions.map((definition) => definition.id) },
        ],
    );
    const attackerCard = initial.players[alice]?.library[0];
    if (attackerCard === undefined) throw new Error("Expected attacker in Alice's library");
    const attackerOnBattlefield = mustMoveToBattlefield(initial, attackerCard);

    let state = attackerOnBattlefield.state;
    const blockers: ObjectId[] = [];
    for (const _definition of blockerDefinitions) {
        const blockerCard = state.players[bob]?.library[0];
        if (blockerCard === undefined) throw new Error("Expected blocker in Bob's library");
        const blockerOnBattlefield = mustMoveToBattlefield(state, blockerCard);
        state = blockerOnBattlefield.state;
        blockers.push(blockerOnBattlefield.newId);
    }

    state = {
        ...state,
        players: {
            ...state.players,
            [alice]: { ...state.players[alice]!, life: 20 },
            [bob]: { ...state.players[bob]!, life: 20 },
        },
        turn: { ...state.turn, activePlayer: alice, step: "combatDamage" },
        combat: {
            rollback: null,
            attackers: {
                [attackerOnBattlefield.newId]: {
                    id: attackerOnBattlefield.newId,
                    attackTarget: { kind: "player", id: bob },
                    ...(blockers.length > 0 ? { blockedBy: blockers } : {}),
                },
            },
        },
    };

    return { state, attacker: attackerOnBattlefield.newId, blockers };
}

describe("combat damage", () => {
    test("an unblocked attacker deals combat damage to the defending player", () => {
        const { state, attacker } = combatState(creature("attacker", 3, 2));

        const result = processCombatDamage(state);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.state.players[bob]?.life).toBe(17);
        expect(result.events).toEqual([
            {
                type: "damageDealt",
                source: attacker,
                sourceLki: snapshotObject(state, attacker),
                amount: 3,
                target: { kind: "player", id: bob },
                targetName: "bob",
                isCombatDamage: true,
            },
        ]);
    });

    describe("declare attackers", () => {
        test("a resolved spell preventing creatures from attacking also restricts creatures that enter later that turn", () => {
            const lateCreature = creature("late-creature", 2, 2, [{ kind: "keyword", keyword: "haste" }]);
            const restrictionSpell: CardDefinition = {
                id: cardDefId("no-attacks-this-turn"),
                name: "No Attacks This Turn",
                cost: [{ kind: "mana", cost: { generic: 0, pips: [] } }],
                colors: [],
                supertypes: [],
                types: ["Instant"],
                subtypes: [],
                power: null,
                toughness: null,
                abilities: [
                    {
                        kind: "spell",
                        targets: [],
                        effects: [
                            {
                                kind: "applyContinuousEffect",
                                template: {
                                    affects: {
                                        kind: "matchingObjects",
                                        filter: {
                                            kind: "all",
                                            of: [
                                                { kind: "inZone", zone: "battlefield" },
                                                { kind: "hasType", type: "Creature" },
                                            ],
                                        },
                                    },
                                    modifications: [{ kind: "cantAttack" }],
                                    duration: "untilEndOfTurn",
                                },
                            },
                        ],
                        text: "Creatures can't attack this turn.",
                    },
                ],
            };
            const spellAbility = restrictionSpell.abilities[0];
            if (spellAbility?.kind !== "spell") throw new Error("Expected a spell ability");
            const initialState = createGame([restrictionSpell, lateCreature], [
                { id: alice, deck: [restrictionSpell.id, lateCreature.id] },
                { id: bob, deck: [] },
            ]);
            const spellCard = initialState.players[alice]?.library.find((id) => initialState.objects[id]?.definitionId === restrictionSpell.id);
            if (spellCard === undefined) throw new Error("Expected the restriction spell in Alice's library");
            const spellOnStack = moveObject(initialState, spellCard, "stack");
            if (spellOnStack === null) throw new Error("Expected the spell to move to the stack");
            const [stackState, stackId] = nextID<StackId>(spellOnStack.state);
            const spellState: GameState = {
                ...stackState,
                stack: [
                    {
                        kind: "spell",
                        id: stackId,
                        controller: alice,
                        source: spellOnStack.newId,
                        targets: [],
                        ability: spellAbility,
                        bindings: {},
                    },
                ],
                priority: null,
            };

            const resolved = beginResolution(spellState);

            expect(resolved.ok).toBe(true);
            if (!resolved.ok) return;
            const lateCreatureCard = resolved.state.players[alice]?.library.find((id) => resolved.state.objects[id]?.definitionId === lateCreature.id);
            if (lateCreatureCard === undefined) throw new Error("Expected the late creature in Alice's library");
            const creatureOnBattlefield = mustMoveToBattlefield(resolved.state, lateCreatureCard);
            const state: GameState = {
                ...creatureOnBattlefield.state,
                turn: { ...creatureOnBattlefield.state.turn, activePlayer: alice, step: "declareAttackers" },
                combat: null,
                pending: null,
            };

            const result = beginCombat(state);

            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.state.combat).toBeNull();
            expect(result.state.pending).toBeNull();
        });

        test("a creature with a static ability that prevents attacking is not offered as an attacker", () => {
            const attackerDefinition = creature("restricted-attacker", 2, 2, [
                { kind: "keyword", keyword: "haste" },
                {
                    kind: "static",
                    activeZones: ["battlefield"],
                    text: "This creature can't attack.",
                    effect: {
                        affects: { kind: "self" },
                        modifications: [{ kind: "cantAttack" }],
                    },
                },
            ]);
            const { state: initialState } = combatState(attackerDefinition);
            const state: GameState = {
                ...initialState,
                turn: { ...initialState.turn, step: "declareAttackers" },
                combat: null,
                pending: null,
            };

            const result = beginCombat(state);

            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.state.combat).toBeNull();
            expect(result.state.pending).toBeNull();
        });
    });

    describe("declare blockers", () => {
        test("a creature with a static ability that prevents blocking can't block", () => {
            const restrictedBlocker = creature("restricted-blocker", 2, 2, [
                {
                    kind: "static",
                    activeZones: ["battlefield"],
                    text: "This creature can't block.",
                    effect: {
                        affects: { kind: "self" },
                        modifications: [{ kind: "cantBlock" }],
                    },
                },
            ]);
            const { state: initialState, attacker, blockers } = combatState(creature("attacker", 2, 2), [restrictedBlocker]);
            const blocker = blockers[0]!;
            const state: GameState = {
                ...initialState,
                turn: { ...initialState.turn, step: "declareBlockers" },
                combat: {
                    rollback: null,
                    attackers: {
                        [attacker]: { id: attacker, attackTarget: { kind: "player", id: bob } },
                    },
                },
            };

            const result = beginDeclareBlockers(state);

            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.state.combat?.attackers[attacker]?.blockedBy).toBeUndefined();
            expect(result.events.some((event) => event.type === "blockDeclared" && event.blockerLki.id === blocker)).toBe(false);
        });

        test.each(["static", "continuous"] as const)("a creature whose flying is removed by a %s effect can be blocked without flying or reach", (effectKind) => {
            const flyingAttacker = creature("flying-attacker", 2, 2, [{ kind: "keyword", keyword: "flying" }]);
            const staticAbility = {
                kind: "static" as const,
                activeZones: ["battlefield" as const],
                effect: {
                    affects: {
                        kind: "matchingObjects" as const,
                        filter: { kind: "hasKeyword" as const, keyword: "flying" as const },
                    },
                    modifications: [{ kind: "removeKeywords" as const, keywords: ["flying" as const] }],
                },
                text: "",
            };
            const blockerDefinition = creature("ground-blocker", 2, 2, effectKind === "static" ? [staticAbility] : []);
            const { state: initialState, attacker, blockers } = combatState(flyingAttacker, [blockerDefinition]);
            const blocker = blockers[0]!;
            let state: GameState = {
                ...initialState,
                turn: { ...initialState.turn, step: "declareBlockers" },
                combat: {
                    rollback: null,
                    attackers: {
                        [attacker]: { id: attacker, attackTarget: { kind: "player", id: bob } },
                    },
                },
            };

            if (effectKind === "continuous") {
                const [nextState, effect] = makeContinuousEffect(state, {
                    source: blocker,
                    controller: bob,
                    affects: { kind: "objects", ids: [attacker] },
                    modification: { kind: "removeKeywords", keywords: ["flying"] },
                    duration: "permanent",
                    sourceName: "blocker",
                });
                state = { ...nextState, continuousEffects: [...nextState.continuousEffects, effect] };
            }

            expect(hasKeyword(state, attacker, "flying")).toBe(false);
            expect(hasKeyword(state, blocker, "flying")).toBe(false);

            const blockDecisionResult = beginDeclareBlockers(state);
            expect(blockDecisionResult.ok).toBe(true);
            if (!blockDecisionResult.ok) return;
            const decision = blockDecisionResult.state.pending;
            expect(decision?.kind).toBe("choose");
            if (decision?.kind !== "choose") return;
            const blockOption = decision.options.find((option) => option.value.kind === "object" && option.value.id === attacker);
            expect(blockOption).toBeDefined();
            if (!blockOption) return;

            const result = submitAnswer(blockDecisionResult.state, {
                player: bob,
                decision: decision.id,
                answer: { kind: "choose", selected: [blockOption.id] },
            });

            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.state.combat?.attackers[attacker]?.blockedBy).toContain(blocker);
        });
    });

    test("a blocked attacker without trample damages its blocker but not the player", () => {
        const { state, attacker, blockers } = combatState(creature("attacker", 3, 4), [creature("blocker", 2, 2)]);
        const blocker = blockers[0]!;

        const result = processCombatDamage(state);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.state.objects[blocker]).toBeUndefined();
        const blockerMoved = result.events.find((event) => event.type === "cardMoved" && event.oldId === blocker);
        expect(blockerMoved).toMatchObject({
            type: "cardMoved",
            from: "battlefield",
            to: "graveyard",
            before: { id: blocker, damage: 3, zone: "battlefield" },
        });
        if (blockerMoved?.type !== "cardMoved") throw new Error("Expected the blocker to die");
        expect(result.state.players[bob]?.graveyard).toContain(blockerMoved.newId);
        expect(result.state.objects[attacker]?.damage).toBe(2);
        expect(result.state.players[bob]?.life).toBe(20);
        expect(damageSummary(result.events)).toEqual([
            [{ kind: "object", id: blocker }, 3, true],
            [{ kind: "object", id: attacker }, 2, true],
        ]);
    });

    test("a trampling attacker assigns lethal damage to its blocker and excess to the player", () => {
        const { state, attacker, blockers } = combatState(creature("trampler", 5, 5, [{ kind: "keyword", keyword: "trample" }]), [creature("blocker", 2, 2)]);
        const blocker = blockers[0]!;

        const result = processCombatDamage(state);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.state.objects[blocker]).toBeUndefined();
        const blockerMoved = result.events.find((event) => event.type === "cardMoved" && event.oldId === blocker);
        expect(blockerMoved).toMatchObject({
            type: "cardMoved",
            from: "battlefield",
            to: "graveyard",
            before: { id: blocker, damage: 2, zone: "battlefield" },
        });
        if (blockerMoved?.type !== "cardMoved") throw new Error("Expected the blocker to die");
        expect(result.state.players[bob]?.graveyard).toContain(blockerMoved.newId);
        expect(result.state.objects[attacker]?.damage).toBe(2);
        expect(result.state.players[bob]?.life).toBe(17);
        expect(damageSummary(result.events)).toEqual([
            [{ kind: "object", id: blocker }, 2, true],
            [{ kind: "object", id: attacker }, 2, true],
            [{ kind: "player", id: bob }, 3, true],
        ]);
    });

    test("an attacker orders damage to multiple blockers and assigns remaining damage to the last", () => {
        const { state, attacker, blockers } = combatState(creature("attacker", 5, 5), [creature("first-blocker", 1, 2), creature("second-blocker", 1, 2)]);
        const result = startCombatDamage(state);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const decision = result.state.pending;
        expect(decision?.kind).toBe("order");
        if (decision?.kind !== "order") return;

        const ordered = submitAnswer(result.state, {
            player: alice,
            decision: decision.id,
            answer: { kind: "order", order: [1, 0] },
        });

        expect(ordered.ok).toBe(true);
        if (!ordered.ok) return;
        const firstBlockerMoved = ordered.events.find((event) => event.type === "cardMoved" && event.oldId === blockers[0]);
        const secondBlockerMoved = ordered.events.find((event) => event.type === "cardMoved" && event.oldId === blockers[1]);
        expect(ordered.state.objects[blockers[0]!]).toBeUndefined();
        expect(ordered.state.objects[blockers[1]!]).toBeUndefined();
        expect(firstBlockerMoved).toMatchObject({
            type: "cardMoved",
            from: "battlefield",
            to: "graveyard",
            before: { id: blockers[0], damage: 3, zone: "battlefield" },
        });
        expect(secondBlockerMoved).toMatchObject({
            type: "cardMoved",
            from: "battlefield",
            to: "graveyard",
            before: { id: blockers[1], damage: 2, zone: "battlefield" },
        });
        if (firstBlockerMoved?.type !== "cardMoved" || secondBlockerMoved?.type !== "cardMoved") {
            throw new Error("Expected both blockers to die");
        }
        expect(ordered.state.players[bob]?.graveyard).toContain(firstBlockerMoved.newId);
        expect(ordered.state.players[bob]?.graveyard).toContain(secondBlockerMoved.newId);
        expect(ordered.state.objects[attacker]?.damage).toBe(2);
        expect(damageSummary(ordered.events)).toEqual([
            [{ kind: "object", id: blockers[1] }, 2, true],
            [{ kind: "object", id: attacker }, 1, true],
            [{ kind: "object", id: blockers[0] }, 3, true],
            [{ kind: "object", id: attacker }, 1, true],
        ]);
    });
});
