import { applySequentially, fail, ok, type ApplyResult } from "../core/result";
import { assertNever, withEntry } from "../core/util";
import type { AbilityOfKind } from "../model/abilities";
import type { Characteristics } from "../model/cardDefinition";
import type { ObjectId, PlayerId } from "../model/ids";
import { payMana, type ManaCost } from "../model/mana";
import type { GameState, SourceSnapshot } from "../model/state";
import { sacrificePermanent, tapPermanent } from "./primitives";

// No real logic for now, could add logic around target decisions changing costs later
export function calculateFinalCost(state: GameState, player: PlayerId, chars: Characteristics | null, ability: AbilityOfKind<"spell" | "activated">): ManaCost | null {
    switch (ability.kind) {
        case "spell": {
            return chars?.manaCost ?? null;
        }
        case "activated": {
            return ability.cost.mana ?? null;
        }
        default:
            return assertNever(ability);
    }
}

export function paySpellCosts(state: GameState, player: PlayerId, source: ObjectId, ability: AbilityOfKind<"spell">, manaCost: ManaCost): ApplyResult {
   return payManaCost(state, player, manaCost);
}

export function payAbilityCosts(state: GameState, player: PlayerId, sourceSnapshot: SourceSnapshot , ability: AbilityOfKind<"activated">): ApplyResult {
  let steps: ((state: GameState) => ApplyResult)[] = [];
  if (ability.cost.mana) {
    const currentCost = ability.cost.mana;
    steps.push(((currentState: GameState) => payManaCost(currentState, player, currentCost)))
  }
  if (ability.cost.tap) {
      steps.push((currentState: GameState) => tapPermanent(currentState, sourceSnapshot.id));
  }
  if (ability.cost.sacrificeSelf) {
    steps.push((currentState: GameState) => sacrificePermanent(currentState, sourceSnapshot.id, sourceSnapshot));
  }
  return applySequentially(state, steps);
}

function payManaCost(state: GameState, player: PlayerId, cost: ManaCost): ApplyResult {
    const p  = state.players[player];
    if (!p) return fail("Invalid player");
    const result = payMana(p, cost);
    if (!result) return fail("Unable to pay cost for spell");
    return ok({...state, players: withEntry(state.players, player, result)}, []);
}