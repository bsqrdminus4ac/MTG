import { describe, expect, test } from "vitest";
import { cardDefId, type GameState, type ObjectId } from "@mtg/engine";
import { DEFINITIONS } from "@mtg/definitions";
import { ALICE, newDemoGame } from "./demo";
import { describeAbility, describeManaCost, describePool, findProblems } from "./describe";

const definition = (id: string) => {
  const def = DEFINITIONS.find((d) => d.id === cardDefId(id));
  if (!def) throw new Error(`no definition ${id}`);
  return def;
};

describe("text describers", () => {
  test("mana costs", () => {
    expect(describeManaCost(null)).toBe("—");
    expect(describeManaCost({ generic: 1, pips: ["G"] })).toBe("{1}{G}");
    expect(describeManaCost({ generic: 0, pips: ["R"] })).toBe("{R}");
    expect(describeManaCost({ generic: 0, pips: [] })).toBe("{0}");
  });

  test("mana pools only list what is in them", () => {
    expect(describePool({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })).toBe("empty");
    expect(describePool({ W: 0, U: 0, B: 0, R: 2, G: 1, C: 0 })).toBe("{R}×2 {G}×1");
  });

  test("abilities", () => {
    expect(describeAbility({ kind: "keyword", keyword: "flying" })).toBe("Keyword: flying");
    expect(describeAbility(definition("forest").abilities[0]!)).toBe("Mana ability: {T} → add 1× {G}");
    expect(describeAbility(definition("bolt").abilities[0]!)).toBe(
      "Spell targeting 1 of any target: deal 3 damage to target 1",
    );
  });
});

describe("findProblems", () => {
  test("finds nothing wrong with a fresh game", () => {
    expect(findProblems(newDemoGame())).toEqual([]);
  });

  test("reports a zone that lists an object that doesn't exist", () => {
    const game = newDemoGame();
    const missing = game.players[ALICE]!.hand[0]!;
    const objects = Object.fromEntries(
      Object.entries(game.objects).filter(([id]) => Number(id) !== missing),
    ) as GameState["objects"];

    const problems = findProblems({ ...game, objects });
    expect(problems.some((p) => p.includes(`#${missing}`) && p.includes("not in state.objects"))).toBe(true);
  });

  test("reports an object whose own zone disagrees with the list holding it", () => {
    const game = newDemoGame();
    const id: ObjectId = game.players[ALICE]!.hand[0]!;
    const obj = game.objects[id]!;
    const problems = findProblems({ ...game, objects: { ...game.objects, [id]: { ...obj, zone: "graveyard" } } });

    expect(problems.some((p) => p.includes("is in alice's hand but its zone says \"graveyard\""))).toBe(true);
    expect(problems.some((p) => p.includes("no graveyard lists it"))).toBe(true);
  });
});
