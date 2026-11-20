import { applySequentially, fail, isTrue, ok, type ApplyResult } from "../core/result";
import { assertNever, withEntry } from "../core/util";
import type { AbilityOfKind } from "../model/abilities";
import { getCharacteristics, snapshotObject } from "../model/characteristics";
import type { Cost, CostComponent, ResolvedCost, ResolvedCostComponent } from "../model/costs";
import { evalObjectPredicate } from "../model/evalPredicates";
import type { ObjectId, PlayerId } from "../model/ids";
import { combineManaCosts, payMana, type ManaCost } from "../model/mana";
import type { ObjectPredicate } from "../model/predicates";
import type { EvalScope, GameState, ObjectSnapshot } from "../model/state";
import { getFlagBinding } from "./bindings";
import { resolveAmount } from "./conditions";
import { discardCard, loseLife, sacrificePermanent, tapPermanent } from "./primitives";
import { getTotalCostModifications } from "./restrictions";

export type TotalCost = Readonly<{
    mana: ManaCost | null;
    components: ResolvedCost;
    changes: readonly { source: ObjectId; sourceName: string }[]; // which effects altered it
}>;

export function calculateFinalCost(state: GameState, scope: EvalScope, ability: AbilityOfKind<"spell" | "activated">): TotalCost {
    const allCosts = ability.kind === "spell" ? getCharacteristics(state, scope.source)?.cost : ability.cost;
    if (!allCosts) return { mana: null, components: [], changes: [] };
    const flattenedCosts = resolveOptionals(state, scope, allCosts);

    let nonMana: ResolvedCost = [];
    let mana: ManaCost | null = null;
    for (const cost of flattenedCosts) {
        if (cost.kind === "mana") mana = combineManaCosts(mana, cost.cost);
        else {
            const resolved = resolveCost(state, scope, cost);
            if (resolved) nonMana = [...nonMana, resolved];
        }
    }
    mana = getTotalCostModifications(state, scope.controller, scope.source, ability, mana);

    return { mana, components: nonMana, changes: [] };
}

function resolveOptionals(state: GameState, scope: EvalScope, costs: Cost): Exclude<CostComponent, { kind: "optional" }>[] {
    return costs.flatMap((cost) => {
        if (cost.kind === "optional") {
            return isTrue(getFlagBinding(scope.bindings, cost.bindAs)) ? resolveOptionals(state, scope, cost.cost) : [];
        }
        return cost;
    });
}

function resolveCost(state: GameState, scope: EvalScope, cost: Exclude<CostComponent, { kind: "optional" | "mana" }>): ResolvedCostComponent | null {
    if (cost.kind === "payLife" || cost.kind === "sacrifice" || cost.kind === "discard") {
        const amount = resolveAmount(state, scope, cost.amount);
        return amount.ok ? { ...cost, amount: amount.value } : null;
    }
    return cost;
}

export function couldPayCost(state: GameState, scope: EvalScope, cost: ResolvedCostComponent): boolean {
    switch (cost.kind) {
        case "payLife":
            return (state.players[scope.controller]?.life ?? 0) > cost.amount;
        case "tapSelf": {
            const obj = state.objects[scope.source];
            if (!obj) return false;
            return obj.zone === "battlefield" && !obj.tapped;
        }
        case "sacrificeSelf": {
            const obj = state.objects[scope.source];
            if (!obj) return false;
            return obj.zone === "battlefield";
        }
        case "sacrifice":
            return getLegalSacrificeChoices(state, scope, true, cost.what).length >= cost.amount;

        case "discard":
            return getLegalDiscardChoices(state, scope, cost.what).length >= cost.amount;
        default:
            assertNever(cost);
    }
}

export function getLegalSacrificeChoices(state: GameState, scope: EvalScope, allowSource: boolean, filter?: ObjectPredicate | undefined): readonly ObjectId[] {
    const excludeSource: ObjectPredicate[] = allowSource ? [] : [{ kind: "not", of: { kind: "isSource" } }];
    const check: ObjectPredicate = {
        kind: "all",
        of: [{ kind: "inZone", zone: "battlefield" }, { kind: "controlledBy", who: "you" }, ...excludeSource, ...(filter ? [filter] : [])],
    }; // Include battlefield check in case card writer didn't - only permanents on battlefield you control can be sacrificed
    const legalChoices: ObjectId[] = [];
    for (const objId of state.battlefield) {
        const snapshot = snapshotObject(state, objId);
        if (!snapshot) continue;
        if (isTrue(evalObjectPredicate(scope, snapshot, check))) legalChoices.push(objId);
    }
    return legalChoices;
}

export function getLegalDiscardChoices(state: GameState, scope: EvalScope, filter?: ObjectPredicate | undefined): readonly ObjectId[] {
    const p = state.players[scope.controller];
    if (!p) return [];
    const legalChoices: ObjectId[] = [];

    for (const objId of p.hand) {
        const snapshot = snapshotObject(state, objId);
        if (!snapshot) continue;
        if (!filter || isTrue(evalObjectPredicate(scope, snapshot, filter))) legalChoices.push(objId);
    }
    return legalChoices;
}

export function payCosts(state: GameState, player: PlayerId, sourceSnapshot: ObjectSnapshot, ability: AbilityOfKind<"spell" | "activated">, cost: TotalCost, costChoices: ObjectId[][]): ApplyResult {
    let steps: ((state: GameState) => ApplyResult)[] = [];
    if (cost.mana) {
        const currentCost = cost.mana;
        steps.push((currentState: GameState) => payManaCost(currentState, player, currentCost));
    }
    for (const [i, c] of cost.components.entries()) {
        switch (c.kind) {
            case "tapSelf": {
                if (ability.kind === "activated") steps.push((currentState: GameState) => tapPermanent(currentState, sourceSnapshot.id));
                break;
            }
            case "sacrificeSelf": {
                if (ability.kind === "activated")
                    steps.push((currentState: GameState) =>
                        sacrificePermanent(currentState, sourceSnapshot.id, sourceSnapshot, `to pay for the ${ability.kind} ability of ${sourceSnapshot.chars.name}`),
                    );
                break;
            }
            case "payLife": {
                steps.push((currentState: GameState) => loseLife(currentState, player, c.amount));
                break;
            }
            case "sacrifice": {
                const selected = costChoices[i];
                const desc = `to pay for ${ability.kind === "spell" ? "" : `the ${ability.kind} ability of `} ${sourceSnapshot.chars.name}`;
                if (selected) steps.push(...selected.map((sac) => (currentState: GameState) => sacrificePermanent(currentState, sac, sourceSnapshot, desc)));
                break;
            }
            case "discard": {
                const selected = costChoices[i];
                const desc = `to pay for ${ability.kind === "spell" ? "" : `the ${ability.kind} ability of `} ${sourceSnapshot.chars.name}`;
                if (selected) steps.push(...selected.map((discard) => (currentState: GameState) => discardCard(currentState, discard, desc)));
                break;
            }
            default:
                assertNever(c);
        }
    }
    return applySequentially(state, steps);
}

function payManaCost(state: GameState, player: PlayerId, cost: ManaCost): ApplyResult {
    const p = state.players[player];
    if (!p) return fail("Invalid player");
    const result = payMana(p, cost);
    if (!result) return fail("Unable to pay cost for spell");
    return ok({ ...state, players: withEntry(state.players, player, result) }, []);
}
