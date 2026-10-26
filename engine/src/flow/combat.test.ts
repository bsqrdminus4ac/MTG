import { describe, expect, test } from "vitest";
import { submitAnswer } from "../engine";
import type { CardDefinition } from "../model/cards";
import type { GameEvent } from "../model/events";
import { cardDefId, playerId, type ObjectId } from "../model/ids";
import type { GameState } from "../model/state";
import { moveObject } from "../model/zones";
import { createGame } from "../setup";
import { processCombatDamage, startCombatDamage } from "./combat";

const alice = playerId("alice");
const bob = playerId("bob");

const creature = (
    id: string,
    power: number,
    toughness: number,
    abilities: CardDefinition["abilities"] = [],
): CardDefinition => ({
    id: cardDefId(id),
    name: id,
    manaCost: { generic: 0, pips: [] },
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
    return events
        .filter((event): event is Extract<GameEvent, { type: "damageDealt" }> => event.type === "damageDealt")
        .map((event) => [event.target, event.amount, event.isCombatDamage] as const);
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
                sourceName: "attacker",
                amount: 3,
                target: { kind: "player", id: bob },
                targetName: "",
                isCombatDamage: true,
            },
        ]);
    });

    test("a blocked attacker without trample damages its blocker but not the player", () => {
        const { state, attacker, blockers } = combatState(
            creature("attacker", 3, 4),
            [creature("blocker", 2, 2)],
        );
        const blocker = blockers[0]!;

        const result = processCombatDamage(state);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.state.objects[blocker]?.damage).toBe(3);
        expect(result.state.objects[attacker]?.damage).toBe(2);
        expect(result.state.players[bob]?.life).toBe(20);
        expect(damageSummary(result.events)).toEqual([
            [{ kind: "object", id: blocker }, 3, true],
            [{ kind: "object", id: attacker }, 2, true],
        ]);
    });

    test("a trampling attacker assigns lethal damage to its blocker and excess to the player", () => {
        const { state, attacker, blockers } = combatState(
            creature("trampler", 5, 5, [{ kind: "keyword", keyword: "trample" }]),
            [creature("blocker", 2, 2)],
        );
        const blocker = blockers[0]!;

        const result = processCombatDamage(state);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.state.objects[blocker]?.damage).toBe(2);
        expect(result.state.objects[attacker]?.damage).toBe(2);
        expect(result.state.players[bob]?.life).toBe(17);
        expect(damageSummary(result.events)).toEqual([
            [{ kind: "object", id: blocker }, 2, true],
            [{ kind: "object", id: attacker }, 2, true],
            [{ kind: "player", id: bob }, 3, true],
        ]);
    });

    test("an attacker orders damage to multiple blockers and assigns remaining damage to the last", () => {
        const { state, attacker, blockers } = combatState(creature("attacker", 5, 5), [
            creature("first-blocker", 1, 2),
            creature("second-blocker", 1, 2),
        ]);
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
        expect(ordered.state.objects[blockers[0]!]?.damage).toBe(3);
        expect(ordered.state.objects[blockers[1]!]?.damage).toBe(2);
        expect(ordered.state.objects[attacker]?.damage).toBe(2);
        expect(damageSummary(ordered.events)).toEqual([
            [{ kind: "object", id: blockers[1] }, 2, true],
            [{ kind: "object", id: attacker }, 1, true],
            [{ kind: "object", id: blockers[0] }, 3, true],
            [{ kind: "object", id: attacker }, 1, true],
        ]);
    });
});
