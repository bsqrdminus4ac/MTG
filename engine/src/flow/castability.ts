import { type Result, badResult, goodResult } from "../core/result";
import { getCharacteristics } from "../model/characteristics";
import type { ObjectId, PlayerId } from "../model/ids";
import type { EvalScope, GameState } from "../model/state";
import { findActivatableAbility } from "../rules/abilityQueries";
import { calculateFinalCost } from "../rules/costs";
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

    // 2. targets (iterates objects)
    const scope: EvalScope = { controller: player, source: card,  bindings: {}};
    if (!hasEnoughTargets(state, scope, spell.targets)) return badResult("There aren't enough legal targets");

    // 3. mana (recursive search, so last)
    const cost = calculateFinalCost(state, player, chars, spell);
    if (!cost || !couldHaveManaToPayCost(state, player, cost, {}, card)) return badResult("You can't pay for that");
    return goodResult(null);
}

export function checkActivatable(state: GameState, player: PlayerId, source: ObjectId, abilityIndex: number): Result<null> {
    const abilityInfo = findActivatableAbility(state, player, source, abilityIndex);
    if (!abilityInfo.ok) return abilityInfo;

    const scope: EvalScope = { controller: player, source,  bindings: {}};
    if (!hasEnoughTargets(state, scope, abilityInfo.value.ability.targets)) return badResult("There aren't enough legal targets");

    const cost = calculateFinalCost(state, player, abilityInfo.value.chars, abilityInfo.value.ability);
    if (cost && !couldHaveManaToPayCost(state, player, cost, {}, source)) return badResult("You can't pay for that");
    return goodResult(null);
}