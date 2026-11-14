import { type ApplyResult, fail } from "../core/result";
import type { AbilityOfKind, AbilityRef } from "../model/abilities";
import { snapshotObject } from "../model/characteristics";
import { abilityText } from "../model/effects";
import type { ObjectId, PlayerId } from "../model/ids";
import type { AbilityCast, GameState } from "../model/state";
import { findActivatableAbility } from "../rules/abilityQueries";
import { checkActivatable } from "./castability";
import { continueCasting } from "./casting";
import { activateManaAbility } from "./manaAbilities";

export function activateAbilityForPriority(state: GameState, player: PlayerId, source: ObjectId, abilityRef: AbilityRef): ApplyResult {
    const found = findActivatableAbility(state, player, source, abilityRef);
    if (!found.ok) return fail(found.error);

    if (found.value.ability.isManaAbility) {
        return activateManaAbility(state, player, source, abilityRef);
    } else {
        return beginActivation(state, player, source, abilityRef, found.value.ability);
    }
}

export function beginActivation(state: GameState, player: PlayerId, source: ObjectId, abilityRef: AbilityRef, ability: AbilityOfKind<"activated">): ApplyResult {
    const activatable = checkActivatable(state, player, source, abilityRef);
    if (!activatable.ok) return activatable;

    const rollback = state;
    const sourceSnapshot = snapshotObject(state, source);
    if (!sourceSnapshot) return fail("Source object is gone");
    const targetSpecs = new Array(ability.targets.length).fill(false);
    const casting: AbilityCast = {
        player,
        card: source,
        kind: ability.kind,
        ability,
        targets: [],
        targetSpecsSelected: targetSpecs,
        cost: null,
        bindings: {},
        rollback,
        sourceSnapshot,
        events: [{ type: "abilityActivateStart", player, abilitySource: source, sourceName: sourceSnapshot.chars.name, description: abilityText(ability, sourceSnapshot.chars.name) }],
    };

    return continueCasting({ ...state, casting });
}
