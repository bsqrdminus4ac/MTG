import { describe, expect, test } from "vitest";
import { ALICE, BOB, triggeredAbilityTestGame } from "./demo";

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
