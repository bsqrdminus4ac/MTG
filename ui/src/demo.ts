import { createGame, drawCard, moveObject, playerId, withPriorityDecision, type CardDefId, type GameState } from "@mtg/engine";

import {
    ALL_DEFINITIONS,
    arcaneElf,
    bear,
    bolt,
    cask,
    clockworkScribe,
    discardLife,
    drake,
    dustyFilter,
    forest,
    grove,
    island,
    mountain,
    painfulPeak,
    pyroAdept,
    reclamation,
    scrapIdol,
    scrapShooter,
    skeins,
    treasureChest,
    visionarySprite,
} from "@mtg/definitions";

export const ALICE = playerId("Alice");
export const BOB = playerId("Bob");

/** Three repeats of a 7-card cycle. The last element is the top of the library, so the opening hand is one full cycle. */
const CYCLE = [forest, bear, mountain, bolt, discardLife, drake, skeins];
const deck = (): CardDefId[] => Array.from({ length: 3 }, () => CYCLE.map((c) => c.id)).flat();

/** Two players, unshuffled 21-card decks, and a 7-card hand each. */
export function newDemoGame(): GameState {
    let state = createGame(ALL_DEFINITIONS, [
        { id: ALICE, deck: deck() },
        { id: BOB, deck: deck() },
    ]);
    for (const player of [ALICE, BOB]) {
        for (let i = 0; i < 7; i++) state = drawCard(state, player).state;
    }
    // Drawing happened outside the engine's turn flow, so ask the opening question again.
    return withPriorityDecision(state);
}

/** A fixed activation-testing scenario with all activation cards on the battlefield. */
export function activationTestGame(): GameState {
    const permanents = [
        { player: ALICE, cards: [pyroAdept, clockworkScribe, arcaneElf, scrapIdol, treasureChest, dustyFilter, grove] },
        { player: BOB, cards: [scrapShooter, treasureChest, painfulPeak, dustyFilter] },
    ] as const;
    let state = createGame(
        ALL_DEFINITIONS,
        permanents.map(({ player, cards }) => ({
            id: player,
            deck: cards.map((card) => card.id),
        })),
    );

    for (const { player, cards } of permanents) {
        for (const card of cards) {
            const cardInLibrary = state.players[player]?.library.find((id) => state.objects[id]?.definitionId === card.id);
            if (cardInLibrary === undefined) throw new Error(`Missing ${card.name} in ${player}'s library`);
            const moved = moveObject(state, cardInLibrary, "battlefield");
            if (!moved) throw new Error(`Unable to move ${card.name} to the battlefield`);
            state = moved.state;
        }
    }

    state = {
        ...state,
        turn: { number: 2, activePlayer: ALICE, step: "precombatMain" },
        priority: { holder: ALICE, consecutivePasses: 0 },
    };
    return withPriorityDecision(state);
}

/** A mixed-card scenario for entering-the-battlefield and dies-trigger testing. */
export function triggeredAbilityTestGame(): GameState {
    const decks = [
        {
            player: ALICE,
            cards: [forest, island, reclamation, bear, visionarySprite, bolt, drake, bear, bolt, drake, bear, visionarySprite, cask],
            battlefield: [forest, island, reclamation, cask],
        },
        {
            player: BOB,
            cards: [forest, mountain, bear, bolt, drake, bear, bolt, drake, bear, bolt, drake, bear, cask],
            battlefield: [forest, mountain, cask],
        },
    ] as const;
    let state = createGame(
        ALL_DEFINITIONS,
        decks.map(({ player, cards }) => ({
            id: player,
            deck: cards.map((card) => card.id),
        })),
    );

    for (const { player, battlefield } of decks) {
        for (const card of battlefield) {
            const cardInLibrary = state.players[player]?.library.find((id) => state.objects[id]?.definitionId === card.id);
            if (cardInLibrary === undefined) throw new Error(`Missing ${card.name} in ${player}'s library`);
            const moved = moveObject(state, cardInLibrary, "battlefield");
            if (!moved) throw new Error(`Unable to move ${card.name} to the battlefield`);
            state = moved.state;
        }
    }

    for (const player of [ALICE, BOB]) {
        for (let i = 0; i < 5; i++) state = drawCard(state, player).state;
    }

    state = {
        ...state,
        turn: { number: 2, activePlayer: ALICE, step: "precombatMain" },
        priority: { holder: ALICE, consecutivePasses: 0 },
    };
    return withPriorityDecision(state);
}
