import type { Action } from "./actions";
import { tapPermanent, type AbilityOfKind } from "./cards";
import { applyTargetSelections, beginCast, cancelCast, payManaOptions, resolveSpell } from "./casting";
import { getCardName, getCharacteristics, isPermanentType } from "./characteristics";
import {
    applyAttackSelectionDecision,
    applyAttackTargetDecision,
    applyChooseBlocksDecision,
    applyDamageOrderingDecision,
    beginCombat,
    beginDeclareBlockers,
    cancelAttacks,
    cancelBlocks,
    processCombatDamage,
} from "./combat";
import { chooseMany, objectChoice, resolveChooseAnswer, resolveOrderingAnswer, resolvePriorityAnswer, resolveYesNoAnswer, type Choice, type Continuation, type Submission } from "./decisions";
import type { GameEvent } from "./events";
import type { ObjectId, PlayerId } from "./ids";
import { addMana, emptyPool } from "./mana";
import { canPlayLand, openDecision, withPriorityDecision } from "./prompts";
import { beginResolution, handleResolutionDecision } from "./resolution";
import {
    STEPS,
    stepGrantsPriority,
    type GameState,
    type Step,
    type Target,
    type Zone,
} from "./state";
import { checkStateBasedActions } from "./stateBasedActions";
import { assertNever, withEntry } from "./util";
import { commitSpell, drawCard, moveObject } from "./zones";

export const MAX_HAND_SIZE = 7;

export type ApplyResult = Readonly<{ ok: true; state: GameState; events: readonly GameEvent[]; changesMade?: boolean }> | Readonly<{ ok: false; error: string }>;

export const ok = (state: GameState, events: readonly GameEvent[], changesMade?: boolean): ApplyResult =>
    changesMade === undefined ? { ok: true, state, events } : { ok: true, state, events, changesMade };
export const fail = (error: string): ApplyResult => ({ ok: false, error });

export function applySequentially(state: GameState, steps: readonly ((state: GameState) => ApplyResult)[]): ApplyResult {
    let currentState = state;
    const events: GameEvent[] = [];
    let changesMade = false;
    for (const step of steps) {
        const result = step(currentState);
        if (!result.ok) return result;
        currentState = result.state;
        events.push(...result.events);
        if (result.changesMade) changesMade = true;
        if (currentState.winner) break; // Stop processing if a winner has been determined
    }
    return ok(currentState, events, changesMade);
}


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

  if (submission.answer.kind === "cancel") {
      if (!d.onCancel) {
          return fail("This decision cannot be canceled");
      }
      return resume(state, d.onCancel, d.player, { kind: "cancel" });
  }

  switch (d.kind) {
      case "priority": {
          const r = resolvePriorityAnswer(d, submission.answer);
          return r.ok ? applyAction(state, r.value.action) : fail(r.error);
      }
      case "yesNo": {
          const r = resolveYesNoAnswer(d, submission.answer);
          return r.ok ? resume(state, d.then, d.player, { kind: "yesNo", value: r.value }) : fail(r.error);
      }
      case "choose": {
          const r = resolveChooseAnswer(d, submission.answer);
          return r.ok ? resume(state, d.then, d.player, { kind: "choose", chosen: r.value }) : fail(r.error);
      }
      case "order": {
          const r = resolveOrderingAnswer(d, submission.answer);
          return r.ok ? resume(state, d.then, d.player, { kind: "order", options: d.options, order: r.value }) : fail(r.error);
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
          return beginCast(state, action.player, action.card);
      case "activateAbility":
          return activateAbilityForPriority(
              state,
              action.player,
              action.source,
              action.abilityIndex,
          );
      case "declareAttackers":
          return fail("Declaring attackers is not implemented yet");
      case "declareBlockers":
          return fail("Declaring blockers is not implemented yet");
      case "cancelSpellCast":
          return fail("Canceling spell casts is not implemented yet");
      default:
          return assertNever(action);
  }
}

// ---------------------------------------------------------------------------
// Resuming after a yesNo / choose decision
// ---------------------------------------------------------------------------

export type Resolved =
    | Readonly<{ kind: "yesNo"; value: boolean }>
    | Readonly<{ kind: "choose"; chosen: readonly Choice[] }>
    | Readonly<{ kind: "order"; options: readonly Choice[]; order: readonly number[] }>
    | Readonly<{ kind: "cancel" }>;

function resume(state: GameState, then: Continuation, player: PlayerId, answer: Resolved): ApplyResult {
    switch (then.kind) {
        case "discardToHandSize": {
            if (answer.kind !== "choose") return fail("Expected a selection");
            return finishDiscard(state, answer.chosen);
        }
        case "cancelAbility": {
            if (answer.kind !== "cancel") return fail("Expected a cancel answer");
            if (state.casting) {
                return cancelCast(state);
            }
            return fail("Cancelling non-casting decisions is not yet supported");
        }
        case "selectAbilityTargets": {
            if (answer.kind !== "choose") return fail("Expected a selection");
            return applyTargetingDecision(state, answer.chosen);
        }
        case "costPayment": {
            if (answer.kind === "choose") {
                return applyAddManaDecision(state, answer.chosen);
            } else if (answer.kind === "yesNo") {
                return applyCommitSpellDecision(state, answer.value);
            } else {
                return fail("Expected a selection or yes/no");
            }
        }
        case "resolveEffect":
            return handleResolutionDecision(state, answer);
        case "selectAttackers":
            if (answer.kind === "cancel") return cancelAttacks(state, player);
            if (answer.kind !== "choose") return fail("Expected a selection");
            return applyAttackSelectionDecision(state, answer.chosen);
        case "selectAttackTargets":
            if (answer.kind !== "choose") return fail("Expected a selection");
            return applyAttackTargetDecision(state, answer.chosen);
        case "cancelAttacks":
            return applySequentially(state, [(currentState) => cancelAttacks(currentState, player), beginCombat]);
        case "selectBlockers":
            if (answer.kind === "cancel") return cancelBlocks(state, player);
            if (answer.kind !== "choose") return fail("Expected a selection");
            return applyChooseBlocksDecision(state, player, then.blocker, answer.chosen);
        case "cancelBlocks":
            return applySequentially(state, [(currentState) => cancelBlocks(currentState, player), beginDeclareBlockers]);
        case "selectDamageOrder":
            if (answer.kind !== "order") return fail("Expected an ordering decision");
            return applyDamageOrderingDecision(state, then.attacker, answer.order);
        default:
            return assertNever(then); // narrows to never once every continuation kind has a case
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

  const events: GameEvent[] = [{ type: "priorityPassed", player, step: state.turn.step }];
  const passes = priority.consecutivePasses + 1;

  if (passes < state.turnOrder.length) {
    const holder = nextPlayer(state, player);
    const result = checkStateBasedActions(state, events);
    if (!result.ok) return result;
    return ok(withPriorityDecision({ ...result.state, priority: { holder, consecutivePasses: passes } }), result.events);
  }

  // Everyone passed in succession: resolve the top of the stack, or end the step.
  return state.stack.length > 0 ? resolveTopOfStack(state, events) : advanceStep(state, events);
}

export function givePriorityToActivePlayer(state: GameState, events: GameEvent[]): ApplyResult {
    const result = checkStateBasedActions(state, []);
    if (!result.ok) return result;
    return ok(
        withPriorityDecision({
            ...result.state,
            priority: { holder: state.turn.activePlayer, consecutivePasses: 0 },
        }),
        [...events, ...result.events],
    );
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
  const result = checkStateBasedActions(state, []);
  if (!result.ok) return result;
  return ok(withPriorityDecision(next), [...moved.events, ...result.events, { type: "landPlayed", player, card: moved.newId, cardName: getCardName(result.state, moved.newId) }]);
}

function resolveTopOfStack(state: GameState, events: readonly GameEvent[]): ApplyResult {
  const result = beginResolution(state);
  if (!result.ok) return result;
  return ok(result.state, [...events, ...result.events]);
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

    next = { ...next, turn: { number, activePlayer, step }, pending: null };
    out.push({ type: "stepStarted", step });
    next = onEnterStep(next, step, wrapped, out);

    if (step === "declareAttackers") {
        const result = beginCombat(next);
        if (!result.ok) return result;
        out.push(...result.events);
        // If no attackers to select, just skip to giving active player priority
        if (result.state.pending) {
            return ok(result.state, out);
        } else {
            next = result.state;
        }
    } else if (step === "declareBlockers") {
        if (!next.combat) {
            continue; // Skip declare blockers step if no attackers are declared
        }
        const result = beginDeclareBlockers(next);
        if (!result.ok) return result;
        if (result.state.pending) {
            return ok(result.state, out);
        } else {
            next = result.state;
        }
    } else if (step === "combatDamage") {
        if (!next.combat) {
            continue; // Skip combat damage step if no attackers are declared
        }
        const result = processCombatDamage(next);
        if (!result.ok) return result;
        next = result.state;
        out.push(...result.events);
    } else if (step === "cleanup") {
        const excess = handExcess(next);
        if (excess > 0) return ok(askDiscard(next, excess), out); // pauses until answered
    }

    if (stepGrantsPriority(step)) return givePriorityToActivePlayer(next, out);
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
        if (o && o.controller === next.turn.activePlayer && o.tapped) {
            objects = withEntry(objects, id, { ...o, tapped: false });
            out.push({ type: "permanentUntapped", object: id, cardName: getCardName(state, id) });
        }
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

// ---------------------------------------------------------------------------
// Ability Activation
// ---------------------------------------------------------------------------

export function activateAbility(state: GameState, player: PlayerId, source: ObjectId, abilityIndex: number): ApplyResult {
    const priority = state.priority;
    if (!priority || priority.holder !== player) return fail("You don't have priority");

    const obj = state.objects[source];
    if (!obj || obj.controller !== player) return fail("That object isn't under your control");
    const chars = getCharacteristics(state, source);
    if (!chars) return fail("That object is gone");
    const ability = chars.abilities[abilityIndex];
    if (!ability) return fail("That object doesn't have that ability");
    if (ability.kind !== "activated") return fail("That ability isn't an activated ability");
    if (!ability.activateableZones.includes(obj.zone)) return fail("That ability can't be activated from that zone");

    // If ability targets are required, we need to ask the player to choose them before we can put the ability on the stack.

    if ((!ability.targets || ability.targets.length === 0) && ability.cost.mana === null) {
        if (ability.isManaAbility) {
            // Mana abilities don't use the stack (CR 605). We just resolve it immediately.
            const payResult = payAbilityCosts(state, player, source, ability);
            if (!payResult.ok) return fail(payResult.error);
            const resolveResult = resolveManaAbility(payResult.state, player, source, ability);
            if (!resolveResult.ok) return fail(resolveResult.error);
            const next = {
                ...resolveResult.state,
                priority: { holder: player, consecutivePasses: 0 },
            };
            const event: GameEvent = {
                type: "abilityActivated",
                player: player,
                abilitySource: source,
                cardName: chars.name,
            };
            return ok(next, [...payResult.events, ...resolveResult.events, event]);
        }
    }

    return fail("That ability requires targets or mana costs, which are not yet implemented");
}

function activateAbilityForPriority(state: GameState, player: PlayerId, source: ObjectId, abilityIndex: number): ApplyResult {
  const steps = [(state: GameState) => activateAbility(state, player, source, abilityIndex), (state: GameState) => checkStateBasedActions(state, [])];
  const next = applySequentially(state, steps);
  if (!next.ok) return next;
  return ok(withPriorityDecision(next.state), next.events);
}

function payAbilityCosts(state: GameState, player: PlayerId, source: ObjectId, ability: AbilityOfKind<"activated">): ApplyResult {
  let steps: ((state: GameState) => ApplyResult)[] = [];
  if (ability.cost.mana) {
    // TODO
  }
  if (ability.cost.tap) {
      steps.push((currentState: GameState) => tapPermanent(currentState, source));
  }
  if (ability.cost.sacrificeSelf) {
    // TODO
  }
  return applySequentially(state, steps);
}

function resolveManaAbility(state: GameState, player: PlayerId, source: ObjectId, ability: AbilityOfKind<"activated">): ApplyResult {
  let events: GameEvent[] = [];
  let currentState = state;
  for (const effect of ability.effects) {
    if (effect.kind === "addMana") {
      const p = currentState.players[player];
      if (!p) return fail("Unknown player");
      currentState = { ...currentState, players: withEntry(currentState.players, player, addMana(p, effect.mana, effect.amount)) };      
      // Maybe add a GameEvent for mana added? Not strictly necessary, but could be useful for UI.
    } else {
      return fail("Unimplemented effect kind for mana ability: " + effect.kind);  
    }
  }
  return ok(currentState, events);
}

// ---------------------------------------------------------------------------
// Spell/Ability Targeting
// ---------------------------------------------------------------------------
function applyTargetingDecision(state: GameState, answer: readonly Choice[]): ApplyResult {
  if (!state.casting) return fail("No spell is currently being cast");
  // Maybe validate against legal targets again? Skipping for now.
  const targetsToAdd: Target[] = [];
  for (const choice of answer) {
    if (choice.value.kind !== "player" && choice.value.kind !== "object") return fail("Invalid choice type for spell targeting");
    else if (choice.value.kind === "player") {
      targetsToAdd.push({kind: "player", id: choice.value.id});
    } else {
      targetsToAdd.push({kind: "object", id: choice.value.id});
    }
  }
  return applyTargetSelections(state, targetsToAdd);
}

function applyAddManaDecision(state: GameState, answer: readonly Choice[]): ApplyResult {
  if (!state.casting) return fail("No spell is currently being cast");
  if (answer.length !== 1) return fail("Can only select one mana ability to use at a time");
  const choice = answer[0]!;
  if (choice.value.kind !== "ability") return fail("Adding mana while casting has to be via an ability");
  const activatedResult = activateAbility(state, state.casting.player, choice.value.id, choice.value.index);
  if (!activatedResult.ok) return activatedResult;
  const casting = activatedResult.state.casting;
  if (!casting) return fail("No spell is currently being cast");
  const nextState: GameState = {
    ...activatedResult.state,
    casting: {
      ...casting,
      events: [...casting.events, ...activatedResult.events],
    },
  };
  return payManaOptions(nextState);
}

function applyCommitSpellDecision(state: GameState, answer: boolean): ApplyResult {
  if (answer) {
    return commitSpell(state);
  } else {
    return cancelCast(state);
  }
}