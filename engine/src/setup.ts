import type { CardDefinition } from "./cards";
import type { CardDefId, ObjectId, PlayerId, Timestamp } from "./ids";
import { emptyPool } from "./mana";
import { withPriorityDecision } from "./prompts";
import type { GameObject, GameState, PlayerState } from "./state";

export interface PlayerSetup {
  readonly id: PlayerId;
  readonly deck: readonly CardDefId[];
}

/**
 * Builds the initial state. Decks are NOT shuffled, and there are no opening hands or mulligans yet.
 * Shuffling needs a seeded RNG stored in GameState so replays stay deterministic.
 */
export function createGame(
  definitions: readonly CardDefinition[],
  setups: readonly PlayerSetup[],
): GameState {
  const first = setups[0];
  if (!first || setups.length < 2) throw new Error("A game needs at least two players");

  const defs = {} as Record<CardDefId, CardDefinition>;
  for (const def of definitions) defs[def.id] = def;

  let counter = 1;
  const objects = {} as Record<ObjectId, GameObject>;
  const players = {} as Record<PlayerId, PlayerState>;

  for (const setup of setups) {
    const library: ObjectId[] = [];
    for (const defId of setup.deck) {
      if (!defs[defId]) throw new Error(`Unknown card definition: ${defId}`);
      const n = counter++;
      const id = n as ObjectId;
      objects[id] = {
        id,
        definitionId: defId,
        owner: setup.id,
        controller: setup.id,
        zone: "library",
        timestamp: n as Timestamp,
        tapped: false,
        damage: 0,
        counters: {},
      };
      library.push(id);
    }
    players[setup.id] = {
        id: setup.id,
        life: 20,
        manaPool: emptyPool(),
        library,
        hand: [],
        graveyard: [],
        landsPlayedThisTurn: 0,
        drewFromEmptyLibrary: false,
        counters: {},
    };
  }

  const state: GameState = {
      definitions: defs,
      objects,
      players,
      turnOrder: setups.map((s) => s.id),
      battlefield: [],
      exile: [],
      stack: [],
      continuousEffects: [],
      turn: { number: 1, activePlayer: first.id, step: "upkeep" },
      priority: { holder: first.id, consecutivePasses: 0 },
      pending: null,
      nextId: counter,
      winner: null,
      casting: null,
      combat: null,
  };  return withPriorityDecision(state);
}
