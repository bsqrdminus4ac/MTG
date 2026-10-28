import { describe, expect, test } from "vitest";
import { createGame } from "../setup";
import type { CardDefinition } from "./cardDefinition";
import { cardDefId, playerId } from "./ids";
import { getRemainingPlayersInTurnOrder } from "./state";

const alice = playerId("alice");
const bob = playerId("bob");
const charlie = playerId("charlie");

const bear: CardDefinition = {
    id: cardDefId("bear"),
    name: "Grizzly Bears",
    manaCost: null,
    colors: [],
    supertypes: [],
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
    abilities: [],
};

function gameWithPlayers(players = [alice, bob]) {
    return createGame([bear], players.map((id) => ({ id, deck: [bear.id] })));
}

describe("getRemainingPlayersInTurnOrder", () => {
    test("starts with the active player and wraps around", () => {
        const state = gameWithPlayers();

        expect(getRemainingPlayersInTurnOrder(state)).toEqual([alice, bob]);
        expect(getRemainingPlayersInTurnOrder({
            ...state,
            turn: { ...state.turn, activePlayer: bob },
        })).toEqual([bob, alice]);
    });

    test("includes each of three players exactly once, starting with the active player", () => {
        const state = gameWithPlayers([alice, bob, charlie]);
        const order = getRemainingPlayersInTurnOrder({
            ...state,
            turn: { ...state.turn, activePlayer: bob },
        });

        expect(order).toEqual([bob, charlie, alice]);
        expect(new Set(order).size).toBe(3);
    });

    test("skips players who have lost, including the active player", () => {
        const state = gameWithPlayers();
        const bobLost = {
            ...state,
            players: { ...state.players, [bob]: { ...state.players[bob]!, hasLostTheGame: true } },
        };
        expect(getRemainingPlayersInTurnOrder(bobLost)).toEqual([alice]);

        const aliceLost = {
            ...state,
            players: { ...state.players, [alice]: { ...state.players[alice]!, hasLostTheGame: true } },
        };
        expect(getRemainingPlayersInTurnOrder(aliceLost)).toEqual([bob]);
    });
});
