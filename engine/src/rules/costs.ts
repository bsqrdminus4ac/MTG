import { applySequentially, fail, ok, type ApplyResult } from "../core/result";
import { withEntry } from "../core/util";
import type { AbilityOfKind } from "../model/abilities";
import { getCharacteristics } from "../model/characteristics";
import type { NonManaCost } from "../model/costs";
import type { ObjectId, PlayerId } from "../model/ids";
import { combineManaCosts, payMana, type ManaCost } from "../model/mana";
import type { GameState, ObjectSnapshot, Target } from "../model/state";
import { sacrificePermanent, tapPermanent } from "./primitives";
import { getTotalCostModifications } from "./restrictions";

export type TotalCost = Readonly<{
    mana: ManaCost | null;
    components: readonly NonManaCost[];
    changes: readonly { source: ObjectId; sourceName: string }[]; // which effects altered it
}>;

export function calculateFinalCost(state: GameState, player: PlayerId, source: ObjectId, ability: AbilityOfKind<"spell" | "activated">, targets?: readonly (readonly Target[])[]): TotalCost {
    const allCosts = ability.kind === "spell" ? getCharacteristics(state, source)?.cost : ability.cost;
    if (!allCosts) return { mana: null, components: [], changes: [] };

    const nonMana: NonManaCost[] = [];
    let mana: ManaCost | null = null;
    for (const cost of allCosts) {
        if (cost.kind === "mana") mana = combineManaCosts(mana, cost.cost);
        else nonMana.push(cost);
    }
    mana = getTotalCostModifications(state, player, source, ability, mana);

    return { mana, components: nonMana, changes: [] };
}

export function payCosts(state: GameState, player: PlayerId, sourceSnapshot: ObjectSnapshot, ability: AbilityOfKind<"spell" | "activated">, cost: TotalCost): ApplyResult {
    let steps: ((state: GameState) => ApplyResult)[] = [];
    if (cost.mana) {
        const currentCost = cost.mana;
        steps.push((currentState: GameState) => payManaCost(currentState, player, currentCost));
    }
    for (const c of cost.components) {
        if (c.kind === "tapSelf" && ability.kind === "activated") {
            steps.push((currentState: GameState) => tapPermanent(currentState, sourceSnapshot.id));
        } else if (c.kind === "sacrificeSelf" && ability.kind === "activated") {
            steps.push((currentState: GameState) => sacrificePermanent(currentState, sourceSnapshot.id, sourceSnapshot, `the ${ability.kind} ability of ${sourceSnapshot.chars.name}`));
        }
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