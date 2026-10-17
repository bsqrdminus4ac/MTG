import type { Action } from "./actions";
import { getCharacteristics, isPermanentType } from "./characteristics";
import {
  chooseMany, objectChoice, resolveChooseAnswer, resolvePriorityAnswer, resolveYesNoAnswer,
  type Choice, type Continuation, type Submission,
} from "./decisions";
import type { GameEvent } from "./events";
import type { ObjectId, PlayerId } from "./ids";
import { emptyPool } from "./mana";
import { canPlayLand, openDecision, withPriorityDecision } from "./prompts";
import { STEPS, stepGrantsPriority, type GameState, type Step, type Zone } from "./state";
import { assertNever, withEntry } from "./util";
import { drawCard, moveObject } from "./zones";

export const MAX_HAND_SIZE = 7;

export type ApplyResult =
  | Readonly<{ ok: true; state: GameState; events: readonly GameEvent[] }>
  | Readonly<{ ok: false; error: string }>;

const ok = (state: GameState, events: readonly GameEvent[]): ApplyResult => ({ ok: true, state, events });
const fail = (error: string): ApplyResult => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Answer the question the engine is waiting on. UIs and AIs should only ever call this:
 * the engine decides what is legal (by building the decision), and this validates the reply.
 */
export function submitAnswer(state: GameState, submission: Submission): ApplyResult {
  if (state.winner !== null) return fail("The game is over");

  const d = state.pending;
  if (!d) return fail("No decision is waiting");
  if (d.id !== submission.decision) return fail("That decision is no longer current");
  if (d.player !== submission.player) return fail("It isn't your decision");

  switch (d.kind) {
    case "priority": {
      const r = resolvePriorityAnswer(d, submission.answer);
      return r.ok ? applyAction(state, r.value.action) : fail(r.error);
    }
    case "yesNo": {
      const r = resolveYesNoAnswer(d, submission.answer);
      return r.ok ? resume(state, d.then, { kind: "yesNo", value: r.value }) : fail(r.error);
    }
    case "choose": {
      const r = resolveChooseAnswer(d, submission.answer);
      return r.ok ? resume(state, d.then, { kind: "choose", chosen: r.value }) : fail(r.error);
    }
    default:
      return assertNever(d);
  }
}

/**
 * Executes one rules-level command. Lower level than submitAnswer: priority options carry
 * an Action, and answering a priority decision ends up here. Useful for tests and scripted play.
 */
export function applyAction(state: GameState, action: Action): ApplyResult {
  if (state.winner !== null) return fail("The game is over");
  if (state.pending && state.pending.kind !== "priority") return fail("A decision must be answered first");

  switch (action.type) {
    case "passPriority":
      return passPriority(state, action.player);
    case "playLand":
      return playLand(state, action.player, action.card);
    case "castSpell":
    case "activateAbility":
    case "declareAttackers":
    case "declareBlockers":
      return fail(`Action not implemented yet: ${action.type}`);
    default:
      return assertNever(action);
  }
}

// ---------------------------------------------------------------------------
// Resuming after a yesNo / choose decision
// ---------------------------------------------------------------------------

type Resolved =
  | Readonly<{ kind: "yesNo"; value: boolean }>
  | Readonly<{ kind: "choose"; chosen: readonly Choice[] }>;

function resume(state: GameState, then: Continuation, answer: Resolved): ApplyResult {
  switch (then.kind) {
    case "discardToHandSize": {
      if (answer.kind !== "choose") return fail("Expected a selection");
      return finishDiscard(state, answer.chosen);
    }
    default:
      return assertNever(then.kind); // narrows to never once every continuation kind has a case
  }
}

// ---------------------------------------------------------------------------
// Priority and the stack
// ---------------------------------------------------------------------------

function nextPlayer(state: GameState, from: PlayerId): PlayerId {
  const i = state.turnOrder.indexOf(from);
  return state.turnOrder[(i + 1) % state.turnOrder.length] ?? from;
}

function passPriority(state: GameState, player: PlayerId): ApplyResult {
  const priority = state.priority;
  if (!priority) return fail("Nobody has priority right now");
  if (priority.holder !== player) return fail("You don't have priority");

  const events: GameEvent[] = [{ type: "priorityPassed", player }];
  const passes = priority.consecutivePasses + 1;

  if (passes < state.turnOrder.length) {
    const holder = nextPlayer(state, player);
    return ok(withPriorityDecision({ ...state, priority: { holder, consecutivePasses: passes } }), events);
  }

  // Everyone passed in succession: resolve the top of the stack, or end the step.
  return state.stack.length > 0 ? resolveTopOfStack(state, events) : advanceStep(state, events);
}

function givePriorityToActivePlayer(state: GameState): GameState {
  return withPriorityDecision({
    ...state,
    priority: { holder: state.turn.activePlayer, consecutivePasses: 0 },
  });
}

function playLand(state: GameState, player: PlayerId, card: ObjectId): ApplyResult {
  const priority = state.priority;
  if (!priority || priority.holder !== player) return fail("You don't have priority");

  const obj = state.objects[card];
  if (!obj || obj.owner !== player || obj.zone !== "hand") return fail("That card isn't in your hand");
  if (!getCharacteristics(state, card)?.types.includes("Land")) return fail("That card isn't a land");
  if (!canPlayLand(state, player)) return fail("You can't play a land right now");

  const moved = moveObject(state, card, "battlefield");
  if (!moved) return fail("That card is gone");

  const p = moved.state.players[player];
  if (!p) return fail("Unknown player");

  // Playing a land is a special action: it doesn't use the stack, and the player keeps priority.
  const next: GameState = {
    ...moved.state,
    players: withEntry(moved.state.players, player, { ...p, landsPlayedThisTurn: p.landsPlayedThisTurn + 1 }),
    priority: { holder: player, consecutivePasses: 0 },
  };
  return ok(withPriorityDecision(next), [
    ...moved.events,
    { type: "landPlayed", player, card: moved.newId },
  ]);
}

function resolveTopOfStack(state: GameState, events: readonly GameEvent[]): ApplyResult {
  const entry = state.stack[state.stack.length - 1];
  if (!entry) return fail("The stack is empty");

  let next: GameState = { ...state, stack: state.stack.slice(0, -1) };
  const out: GameEvent[] = [...events, { type: "stackEntryResolved", id: entry.id }];

  if (entry.kind === "spell") {
    const chars = getCharacteristics(next, entry.source);
    const dest: Zone = chars?.types.some(isPermanentType) ? "battlefield" : "graveyard";
    const moved = moveObject(next, entry.source, dest);
    if (moved) {
      next = moved.state;
      out.push(...moved.events);
    }
  }
  // TODO: interpret the effects (spell abilities / entry.effects), then check state-based actions.

  return ok(givePriorityToActivePlayer(next), out);
}

// ---------------------------------------------------------------------------
// Turn structure
// ---------------------------------------------------------------------------

function advanceStep(state: GameState, events: readonly GameEvent[]): ApplyResult {
  let next = state;
  const out: GameEvent[] = [...events];

  // Keep going until we land on a step where players receive priority.
  for (let guard = 0; guard < STEPS.length + 1; guard++) {
    const index = STEPS.indexOf(next.turn.step) + 1;
    const wrapped = index >= STEPS.length;
    const step: Step = STEPS[wrapped ? 0 : index] ?? "untap";

    let activePlayer = next.turn.activePlayer;
    let number = next.turn.number;
    if (wrapped) {
      activePlayer = nextPlayer(next, activePlayer);
      number += 1;
      out.push({ type: "turnStarted", turn: number, activePlayer });
    }

    next = { ...next, turn: { number, activePlayer, step } };
    out.push({ type: "stepStarted", step });
    next = onEnterStep(next, step, wrapped, out);

    if (step === "cleanup") {
      const excess = handExcess(next);
      if (excess > 0) return ok(askDiscard(next, excess), out); // pauses until answered
    }
    if (stepGrantsPriority(step)) return ok(givePriorityToActivePlayer(next), out);
  }
  return fail("Could not find the next step with priority");
}

function handExcess(state: GameState): number {
  return (state.players[state.turn.activePlayer]?.hand.length ?? 0) - MAX_HAND_SIZE;
}

function askDiscard(state: GameState, count: number): GameState {
  const player = state.turn.activePlayer;
  const hand = state.players[player]?.hand ?? [];
  const options = hand.map((id) => objectChoice(id, getCharacteristics(state, id)?.name ?? "Unknown card"));
  return openDecision({ ...state, priority: null }, (id) =>
    chooseMany({
      id,
      player,
      prompt: `Discard ${count} card${count === 1 ? "" : "s"} to get down to ${MAX_HAND_SIZE}`,
      options,
      min: count,
      max: count,
      then: { kind: "discardToHandSize" },
    }),
  );
}

function finishDiscard(state: GameState, chosen: readonly Choice[]): ApplyResult {
  let next: GameState = { ...state, pending: null };
  const out: GameEvent[] = [];
  for (const choice of chosen) {
    if (choice.value.kind !== "object") return fail("Unexpected choice");
    const moved = moveObject(next, choice.value.id, "graveyard");
    if (!moved) return fail("That card is gone");
    next = moved.state;
    out.push(...moved.events);
  }
  return advanceStep(next, out); // we paused in cleanup, so this moves on to the next turn
}

function onEnterStep(state: GameState, step: Step, newTurn: boolean, out: GameEvent[]): GameState {
  let next = state;

  // Mana empties at the end of every step and phase (CR 500.4).
  let players = next.players;
  for (const id of next.turnOrder) {
    const p = players[id];
    if (p) {
      players = withEntry(players, id, {
        ...p,
        manaPool: emptyPool(),
        landsPlayedThisTurn: newTurn ? 0 : p.landsPlayedThisTurn,
      });
    }
  }
  next = { ...next, players };

  switch (step) {
    case "untap": {
      let objects = next.objects;
      for (const id of next.battlefield) {
        const o = objects[id];
        if (o && o.controller === next.turn.activePlayer) objects = withEntry(objects, id, { ...o, tapped: false });
      }
      return { ...next, objects };
    }
    case "draw": {
      if (next.turn.number === 1) return next; // the starting player skips their first draw (2-player rule)
      const drawn = drawCard(next, next.turn.activePlayer);
      out.push(...drawn.events);
      return drawn.state;
    }
    case "cleanup": {
      let objects = next.objects;
      for (const id of next.battlefield) {
        const o = objects[id];
        if (o) objects = withEntry(objects, id, { ...o, damage: 0 });
      }
      return {
        ...next,
        objects,
        continuousEffects: next.continuousEffects.filter((e) => e.duration !== "untilEndOfTurn"),
      };
    }
    default:
      return next;
  }
}
