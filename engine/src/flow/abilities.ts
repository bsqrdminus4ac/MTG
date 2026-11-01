import { type ApplyResult, applySequentially, fail, ok } from "../core/result";
import type { AbilityOfKind } from "../model/abilities";
import type { Characteristics } from "../model/cardDefinition";
import { describeAbility } from "../model/effects";
import type { ObjectId, PlayerId } from "../model/ids";
import type { AbilityCast, GameObject, GameState, SourceSnapshot } from "../model/state";
import { findActivatableAbility } from "../rules/abilityQueries";
import { checkStateBasedActions } from "../rules/stateBasedActions";
import { checkActivatable } from "./castability";
import { continueCasting } from "./casting";
import { activateManaAbility } from "./manaAbilities";
import { withPriorityDecision } from "./priority";

export function activateAbilityForPriority(state: GameState, player: PlayerId, source: ObjectId, abilityIndex: number): ApplyResult {
    const found = findActivatableAbility(state, player, source, abilityIndex);
    if (!found.ok) return fail(found.error);

    if (!found.value.ability.isManaAbility) {
        return beginActivation(state, player, found.value.obj, found.value.chars, abilityIndex, found.value.ability); // pending target/payment decision is already set; return as is
    }

    const next = applySequentially(state, [(s) => activateManaAbility(s, player, source, abilityIndex), (s) => checkStateBasedActions(s, [])]);
    if (!next.ok) return next;
    return ok(withPriorityDecision(next.state), next.events); // reopen priority; the tapped land drops out of the options
}

export function beginActivation(state: GameState, player: PlayerId, sourceObj: GameObject, chars: Characteristics, abilityIndex: number, ability: AbilityOfKind<"activated">): ApplyResult {
    const activatable = checkActivatable(state, player, sourceObj.id, abilityIndex);
    if (!activatable.ok) return activatable;

    const rollback = state;
    const sourceSnapshot: SourceSnapshot = {
        id: sourceObj.id,
        owner: sourceObj.owner,
        controller: sourceObj.controller,
        chars,
    };
    const targetSpecs = new Array(ability.targets.length).fill(false);
    const casting: AbilityCast = {
        player,
        card: sourceObj.id,
        kind: ability.kind,
        ability,
        targets: [],
        targetSpecsSelected: targetSpecs,
        cost: null,
        bindings: {},
        rollback,
        sourceSnapshot,
        events: [{ type: "abilityActivateStart", player, abilitySource: sourceObj.id, sourceName: chars.name, description: describeAbility(ability, chars.name) }],
    };

    return continueCasting({ ...state, casting });
}
