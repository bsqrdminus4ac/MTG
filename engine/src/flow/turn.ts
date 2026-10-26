import { type ApplyResult, fail, ok } from "../core/result";
import { withEntry } from "../core/util";
import { getCardName, getCharacteristics } from "../model/characteristics";
import { type Choice, chooseMany, objectChoice } from "../model/decisions";
import type { GameEvent } from "../model/events";
import { emptyPool } from "../model/mana";
import { type GameState, nextPlayer } from "../model/state";
import { STEPS, type Step } from "../model/vocabulary";
import { drawCardResult, moveObject } from "../model/zones";
import { openDecision } from "../rules/pending";
import { beginCombat, beginDeclareBlockers, processCombatDamage } from "./combat";
import { givePriorityToActivePlayer } from "./priority";

export const MAX_HAND_SIZE = 7;

export function advanceStep(state: GameState, events: readonly GameEvent[]): ApplyResult {
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
        const result = onEnterStep(next, step, wrapped);
        if (!result.ok) return result;
        next = result.state;
        out.push(...result.events);

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

const stepGrantsPriority = (step: Step): boolean => step !== "untap" && step !== "cleanup";


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

export function finishDiscard(state: GameState, chosen: readonly Choice[]): ApplyResult {
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

export function onEnterStep(state: GameState, step: Step, newTurn: boolean): ApplyResult {
    let next = state;
    const out: GameEvent[] = [];
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
            return ok({ ...next, objects }, out);
        }
        case "draw": {
            if (next.turn.number === 1) return ok(next, out); // the starting player skips their first draw (2-player rule)
            return drawCardResult(next, next.turn.activePlayer);
        }
        case "cleanup": {
            let objects = next.objects;
            for (const id of next.battlefield) {
                const o = objects[id];
                if (o) objects = withEntry(objects, id, { ...o, damage: 0 });
            }
            return ok(
                {
                    ...next,
                    objects,
                    continuousEffects: next.continuousEffects.filter((e) => e.duration !== "untilEndOfTurn"),
                },
                out,
            );
        }
        default:
            return ok(next, out);
    }
}