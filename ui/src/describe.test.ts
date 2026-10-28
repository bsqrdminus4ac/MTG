import { describe, expect, test } from "vitest";
import { cardDefId, type GameState, type ObjectId } from "@mtg/engine";
import { DEFINITIONS } from "@mtg/definitions";
import { ALICE, newDemoGame } from "./demo";
import { describeAbility, describeCardText, describeEffect, describeEffects, describeManaCost, describePool, findProblems } from "./describe";

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
    expect(describeCardText({ kind: "keyword", keyword: "firstStrike" })).toEqual(["First strike"]);
    expect(describeCardText({
      kind: "spell",
      targets: [],
      effects: [{ kind: "gainLife", who: { kind: "player", who: "controller" }, amount: 1, description: "<this> gains life." }],
    }, "Healing Light")).toEqual(["Healing Light gains life."]);
    expect(describeAbility(definition("forest").abilities[0]!)).toBe("Mana ability: {T} → add 1× {G}");
    expect(describeAbility(definition("bolt").abilities[0]!)).toBe(
      "Spell targeting 1 of any target: deal 3 damage to target 1",
    );
  });

  test("expands loop effects and describes their bound values", () => {
    const ability = definition("skeins").abilities[0];
    const effect = ability?.kind === "spell"
      ? ability.effects[0]
      : undefined;

    expect(effect).toBeDefined();
    expect(describeEffect(effect!)).toBe(
      "For each player, Choice: Discard a card; the cards selected by the choice are discarded from their owner's hand",
    );
  });

  test("describes conditional branches and the yes/no answer they depend on", () => {
    expect(describeEffects([
      { kind: "askYesNo", who: { kind: "player", who: "controller" }, prompt: "Gain life?", bindAs: "accepted" },
      {
        kind: "if",
        condition: { kind: "flag", name: "accepted" },
        then: [{ kind: "gainLife", who: { kind: "player", who: "controller" }, amount: 2 }],
        else: [{ kind: "loseLife", who: { kind: "player", who: "controller" }, amount: 1 }],
      },
    ])).toBe(
      "Gain life?; If the answer to “Gain life?” is yes, you gain 2 life; otherwise, you lose 1 life",
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

    expect(problems.some((p) => p.includes('is in Alice\'s hand but its zone says "graveyard"'))).toBe(true);
    expect(problems.some((p) => p.includes("no graveyard lists it"))).toBe(true);
  });
});
