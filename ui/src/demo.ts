import {
  createGame,
  drawCard,
  playerId,
  withPriorityDecision,
  type CardDefId,
  type GameState,
} from "@mtg/engine";

import { bear, bolt, DEFINITIONS, drake, forest, mountain } from "@mtg/definitions";

export const ALICE = playerId("alice");
export const BOB = playerId("bob");



/** Three repeats of a 7-card cycle. The last element is the top of the library, so the opening hand is one full cycle. */
const CYCLE = [forest, bear, mountain, bolt, forest, drake, mountain];
const deck = (): CardDefId[] => Array.from({ length: 3 }, () => CYCLE.map((c) => c.id)).flat();

/** Two players, unshuffled 21-card decks, and a 7-card hand each. */
export function newDemoGame(): GameState {
  let state = createGame(DEFINITIONS, [
    { id: ALICE, deck: deck() },
    { id: BOB, deck: deck() },
  ]);
  for (const player of [ALICE, BOB]) {
    for (let i = 0; i < 7; i++) state = drawCard(state, player).state;
  }
  // Drawing happened outside the engine's turn flow, so ask the opening question again.
  return withPriorityDecision(state);
}
