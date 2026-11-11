import { CONTINUOUS_TEST_CARDS } from "@mtg/definitions";
import { withPriorityDecision } from "@mtg/engine";
import { describe, expect, test } from "vitest";
import { ALICE, BOB, continuousAbilityTestGame, triggeredAbilityTestGame } from "./demo";

describe("triggered ability test game", () => {
  test("starts with triggers, lands, hands, and libraries for both players", () => {
    const state = triggeredAbilityTestGame();
    const alice = state.players[ALICE]!;
    const bob = state.players[BOB]!;

    for (const player of [alice, bob]) {
      expect(player.library.length).toBeGreaterThan(0);
      expect(player.hand.length).toBeGreaterThan(0);
      expect(state.battlefield.some((id) => {
        const object = state.objects[id];
        return object?.owner === player.id && state.definitions[object.definitionId]?.types.includes("Land");
      })).toBe(true);
    }
  });
});

describe("continuous ability test game", () => {
  test("starts with continuous test cards, castable spells, lands, and cards left in both libraries", () => {
    const state = continuousAbilityTestGame();

    for (const playerId of [ALICE, BOB]) {
      const player = state.players[playerId]!;
      expect(player.library.length).toBeGreaterThan(0);
      expect(player.hand.length).toBeGreaterThan(0);
      expect(state.battlefield.some((id) => {
        const object = state.objects[id];
        return object?.owner === playerId && state.definitions[object.definitionId]?.types.includes("Land");
      })).toBe(true);

      const priorityState = withPriorityDecision({
        ...state,
        priority: { holder: playerId, consecutivePasses: 0 },
      });
      expect(
        priorityState.pending?.kind === "priority" &&
        priorityState.pending.options.some((option) => option.action.type === "castSpell"),
      ).toBe(true);
    }

    const onBattlefield = state.battlefield.map((id) => state.objects[id]?.definitionId);
    const inHands = [ALICE, BOB].flatMap((playerId) =>
      state.players[playerId]!.hand.map((id) => state.objects[id]?.definitionId),
    );
    for (const card of CONTINUOUS_TEST_CARDS) {
      expect(onBattlefield.includes(card.id) || inHands.includes(card.id)).toBe(true);
    }
  });
});
