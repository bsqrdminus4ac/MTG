import { describe, expect, test } from "vitest";
import {
  applyAction, cardDefId, chooseMany, chooseOne, createGame, drawCard, indexChoice, playerId,
  priorityOptions, resolveChooseAnswer, resolveYesNoAnswer, submitAnswer, validateAnswer, withPriorityDecision,
  yesNo, type Answer, type CardDefinition, type DecisionId, type GameState, type PlayerId,
} from "./index";

const alice = playerId("alice");
const bob = playerId("bob");

const base = { manaCost: null, colors: [], supertypes: [], subtypes: [], power: null, toughness: null, abilities: [] } as const;
const forest: CardDefinition = { ...base, id: cardDefId("forest"), name: "Forest", types: ["Land"] };
const bear: CardDefinition = {
  ...base, id: cardDefId("bear"), name: "Grizzly Bears", types: ["Creature"], power: 2, toughness: 2,
};

const answer = (g: GameState, a: Answer, player?: PlayerId) => {
  const d = g.pending;
  if (!d) throw new Error("no pending decision");
  return submitAnswer(g, { player: player ?? d.player, decision: d.id, answer: a });
};
const must = (r: ReturnType<typeof submitAnswer>): GameState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const pass: Answer = { kind: "priority", option: "pass" };

describe("priority decisions", () => {
  test("the opening decision belongs to the first player and offers a pass", () => {
    const g = createGame([bear], [{ id: alice, deck: [bear.id] }, { id: bob, deck: [bear.id] }]);
    expect(g.pending).toMatchObject({ kind: "priority", player: alice });
    expect(priorityOptions(g, alice).map((o) => o.id)).toEqual(["pass"]);
  });

  test("answering moves the question to the next player; stale and misdirected answers are rejected", () => {
    const g0 = createGame([bear], [{ id: alice, deck: [bear.id] }, { id: bob, deck: [bear.id] }]);
    const oldId = g0.pending!.id;

    expect(answer(g0, pass, bob).ok).toBe(false); // not bob's decision

    const g1 = must(answer(g0, pass));
    expect(g1.pending).toMatchObject({ kind: "priority", player: bob });
    expect(g1.pending!.id).not.toBe(oldId);

    const stale = submitAnswer(g1, { player: bob, decision: oldId, answer: pass });
    expect(stale.ok).toBe(false);
    expect(answer(g1, { kind: "priority", option: "play:999" }).ok).toBe(false); // not offered
    expect(answer(g1, { kind: "yesNo", value: true }).ok).toBe(false); // wrong kind
  });

  test("land drops are offered in a main phase, played via an answer, and only once per turn", () => {
    const deck = [bear.id, bear.id, forest.id, forest.id, forest.id];
    let g = createGame([bear, forest], [{ id: alice, deck }, { id: bob, deck }]);
    g = drawCard(drawCard(g, alice).state, alice).state;
    expect(g.players[alice]?.hand).toHaveLength(2);

    // Not offered during upkeep.
    expect(priorityOptions(g, alice).map((o) => o.id)).toEqual(["pass"]);

    // Jump to the main phase and ask again.
    g = withPriorityDecision({ ...g, turn: { ...g.turn, step: "precombatMain" } });
    const [first, second] = g.players[alice]!.hand;
    const pending = g.pending;
    const offered = pending?.kind === "priority" ? pending.options.map((o) => o.id) : [];
    expect(offered).toEqual([`play:${first}`, `play:${second}`, "pass"]);

    g = must(answer(g, { kind: "priority", option: `play:${first}` }));
    expect(g.battlefield).toHaveLength(1);
    expect(g.players[alice]?.hand).toHaveLength(1);
    expect(g.players[alice]?.landsPlayedThisTurn).toBe(1);

    // Alice keeps priority, and the second land is no longer offered.
    expect(g.pending).toMatchObject({ kind: "priority", player: alice });
    expect(priorityOptions(g, alice).map((o) => o.id)).toEqual(["pass"]);

    // The same action is also rejected at the rules level.
    const again = applyAction(g, { type: "playLand", player: alice, card: g.players[alice]!.hand[0]! });
    expect(again.ok).toBe(false);
  });
});

describe("answer validation", () => {
  const d = (n: number) => n as DecisionId;
  const options = [indexChoice(0, "A"), indexChoice(1, "B"), indexChoice(2, "C")];
  const then = { kind: "discardToHandSize" } as const;

  test("chooseOne requires exactly one known option", () => {
    const q = chooseOne({ id: d(1), player: alice, prompt: "Pick", options, then });
    expect(resolveChooseAnswer(q, { kind: "choose", selected: ["index:1"] }).ok).toBe(true);
    expect(resolveChooseAnswer(q, { kind: "choose", selected: [] }).ok).toBe(false);
    expect(resolveChooseAnswer(q, { kind: "choose", selected: ["index:0", "index:1"] }).ok).toBe(false);
    expect(resolveChooseAnswer(q, { kind: "choose", selected: ["index:9"] }).ok).toBe(false);
  });

  test("chooseMany enforces its bounds and rejects duplicates", () => {
    const q = chooseMany({ id: d(2), player: alice, prompt: "Pick", options, min: 1, max: 2, then });
    expect(resolveChooseAnswer(q, { kind: "choose", selected: ["index:0", "index:2"] }).ok).toBe(true);
    expect(resolveChooseAnswer(q, { kind: "choose", selected: ["index:0", "index:1", "index:2"] }).ok).toBe(false);
    expect(resolveChooseAnswer(q, { kind: "choose", selected: ["index:0", "index:0"] }).ok).toBe(false);
    expect(() => chooseMany({ id: d(3), player: alice, prompt: "", options, min: 2, max: 5, then })).toThrow();
  });

  test("yesNo accepts only a boolean answer", () => {
    const q = yesNo({ id: d(4), player: alice, prompt: "Keep?", then });
    expect(resolveYesNoAnswer(q, { kind: "yesNo", value: false })).toEqual({ ok: true, value: false });
    expect(validateAnswer(q, { kind: "choose", selected: [] }).ok).toBe(false);
  });
});

describe("discarding to hand size (a choose decision in the engine)", () => {
  test("cleanup pauses for a discard, then the game moves on to the next turn", () => {
    const deck = Array.from({ length: 10 }, () => bear.id);
    let g = createGame([bear], [{ id: alice, deck }, { id: bob, deck }]);
    for (let i = 0; i < 9; i++) g = drawCard(g, alice).state;
    expect(g.players[alice]?.hand).toHaveLength(9);

    g = withPriorityDecision({ ...g, turn: { ...g.turn, step: "end" } });
    g = must(answer(g, pass)); // alice
    g = must(answer(g, pass)); // bob -> everyone passed -> cleanup

    expect(g.turn.step).toBe("cleanup");
    expect(g.priority).toBeNull();
    expect(g.pending).toMatchObject({ kind: "choose", player: alice, min: 2, max: 2 });
    expect(applyAction(g, { type: "passPriority", player: alice }).ok).toBe(false);

    const pending = g.pending;
    const options = pending?.kind === "choose" ? pending.options : [];
    expect(answer(g, { kind: "choose", selected: [options[0]!.id] }).ok).toBe(false); // too few

    g = must(answer(g, { kind: "choose", selected: [options[0]!.id, options[1]!.id] }));
    expect(g.players[alice]?.hand).toHaveLength(7);
    expect(g.players[alice]?.graveyard).toHaveLength(2);
    expect(g.turn).toMatchObject({ number: 2, activePlayer: bob, step: "upkeep" });
    expect(g.pending).toMatchObject({ kind: "priority", player: bob });
  });
});
