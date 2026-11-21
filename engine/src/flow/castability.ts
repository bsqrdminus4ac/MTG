import { badResult, goodResult, type Result } from "../core/result";
import type { AbilityRef } from "../model/abilities";
import { getCharacteristics } from "../model/characteristics";
import type { ResolvedCost } from "../model/costs";
import type { ObjectId, PlayerId } from "../model/ids";
import type { EvalScope, GameState } from "../model/state";
import { findActivatableAbility } from "../rules/abilityQueries";
import { calculateFinalCost, getLegalDiscardChoices, getLegalSacrificeChoices, type TotalCost } from "../rules/costs";
import { cantCastDueToRestriction } from "../rules/restrictions";
import { getAbilityForSpell } from "../rules/stack";
import { hasEnoughTargets } from "../rules/targeting";
import { canCastSpellNow } from "../rules/timing";
import { couldHaveManaToPayCost } from "./manaAbilities";

export function checkCastable(state: GameState, player: PlayerId, card: ObjectId): Result<null> {
    const obj = state.objects[card];
    if (!obj || obj.zone !== "hand" || obj.controller !== player) return badResult("That card isn't in your hand");
    const chars = getCharacteristics(state, card);
    if (!chars || chars.types.includes("Land")) return badResult("That card can't be cast");
    const spell = getAbilityForSpell(chars);
    if (!spell) return badResult("That card has no spell to cast");

    // 1. timing (cheap)
    if (!canCastSpellNow(state, player, chars)) return badResult("You can't cast that card now");

    // 2. restrictions
    if (cantCastDueToRestriction(state, player, card)) return badResult("An ability prevents you from casting that card right now");

    // 3. targets (iterates objects)
    const scope: EvalScope = { controller: player, source: card, bindings: {} };
    if (!hasEnoughTargets(state, scope, spell.targets)) return badResult("There aren't enough legal targets");

    // 4. mana (recursive search, so last)
    const cost = calculateFinalCost(state, scope, spell);
    if (!cost.mana || !couldPayFinalCost(state, scope, cost, [])) return badResult("You can't pay for that");
    return goodResult(null);
}

export function checkActivatable(state: GameState, player: PlayerId, source: ObjectId, abilityRef: AbilityRef): Result<null> {
    const abilityInfo = findActivatableAbility(state, player, source, abilityRef);
    if (!abilityInfo.ok) return abilityInfo;

    const scope: EvalScope = { controller: player, source, bindings: {} };
    if (!hasEnoughTargets(state, scope, abilityInfo.value.ability.targets)) return badResult("There aren't enough legal targets");

    const cost = calculateFinalCost(state, scope, abilityInfo.value.ability);
    if (cost.mana && !couldPayFinalCost(state, scope, cost, [])) return badResult("You can't pay for that");
    return goodResult(null);
}

export type Pool = "sacrifice" | "discard";
export type Demand = { component: number; candidates: ReadonlySet<ObjectId>; count: number };

export function couldPayFinalCost(state: GameState, scope: EvalScope, cost: TotalCost, choicesSoFar: readonly (readonly ObjectId[])[]): boolean {
    const obj = state.objects[scope.source];

    // Life check
    const totalLifeCost = cost.components.reduce((total, c) => (c.kind === "payLife" ? total + c.amount : total), 0);
    if (totalLifeCost > 0 && (state.players[scope.controller]?.life ?? 0) < totalLifeCost) return false;

    //Tap self
    const tapSelfCosts = cost.components.filter((c) => c.kind === "tapSelf");
    if (tapSelfCosts.length > 1 || (tapSelfCosts.length === 1 && (!obj || obj.zone !== "battlefield" || obj.tapped))) return false;

    //Sacrifice self
    const sacrificeSelfCosts = cost.components.filter((c) => c.kind === "sacrificeSelf");
    if (sacrificeSelfCosts.length > 1 || (sacrificeSelfCosts.length === 1 && (!obj || obj.zone !== "battlefield"))) return false;

    // Mana
    if (cost.mana && !couldHaveManaToPayCost(state, scope.controller, cost.mana, {})) return false;

    // Sacrifice
    if (!demandsSatisfiable(buildDemands(state, scope, "sacrifice", cost.components, choicesSoFar))) return false;

    // Discard
    if (!demandsSatisfiable(buildDemands(state, scope, "discard", cost.components, choicesSoFar))) return false;

    return true;
}

export function buildDemands(
    state: GameState,
    scope: EvalScope,
    pool: Pool,
    components: ResolvedCost,
    choices: readonly (readonly ObjectId[])[], // casting.costChoices, indexed by component
): Demand[] {
    const taken = new Set(choices.flat()); // already committed to some component
    const demands: Demand[] = [];
    components.forEach((c, i) => {
        if (pool === "discard" && c.kind === "discard") {
            const remaining = c.amount - (choices[i]?.length ?? 0);
            if (remaining <= 0) return;
            const candidates = getLegalDiscardChoices(state, scope, c.what).filter((id) => !taken.has(id));
            demands.push({ component: i, candidates: new Set(candidates), count: remaining });
        } else if (pool === "sacrifice") {
            if (c.kind === "sacrificeSelf") {
                demands.push({ component: i, candidates: new Set([scope.source]), count: 1 });
            } else if (c.kind === "sacrifice") {
                const remaining = c.amount - (choices[i]?.length ?? 0);
                if (remaining <= 0) return;
                const candidates = getLegalSacrificeChoices(state, scope, c.what).filter((id) => !taken.has(id));
                demands.push({ component: i, candidates: new Set(candidates), count: remaining });
            }
        }
    });
    return demands;
}

export function safePicks(demands: readonly Demand[], component: number): ObjectId[] {
    const mine = demands.find((d) => d.component === component);
    if (!mine) return [];
    return [...mine.candidates].filter((o) => demandsSatisfiable(afterPick(demands, component, o)));
}

function afterPick(demands: readonly Demand[], component: number, pick: ObjectId): Demand[] {
    return demands.flatMap((d) => {
        const candidates = new Set(d.candidates);
        candidates.delete(pick); // nobody can use it again, including this component
        if (d.component !== component) return [{ ...d, candidates }];
        return d.count > 1 ? [{ ...d, candidates, count: d.count - 1 }] : []; // this demand is now fully met
    });
}

function demandsSatisfiable(demands: readonly Demand[]): boolean {
    for (let mask = 1; mask < 1 << demands.length; mask++) {
        let need = 0;
        const union = new Set<ObjectId>();
        demands.forEach((d, i) => {
            if (mask & (1 << i)) {
                need += d.count;
                d.candidates.forEach((c) => union.add(c));
            }
        });
        if (union.size < need) return false;
    }
    return true;
}
