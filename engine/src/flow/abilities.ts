import { type ApplyResult, fail } from "../core/result";
import type { AbilityOfKind } from "../model/abilities";
import { snapshotSource } from "../model/characteristics";
import { describeAbility } from "../model/effects";
import type { ObjectId, PlayerId } from "../model/ids";
import type { AbilityCast, GameState } from "../model/state";
import { findActivatableAbility } from "../rules/abilityQueries";
import { checkActivatable } from "./castability";
import { continueCasting } from "./casting";
import { activateManaAbility } from "./manaAbilities";

export function activateAbilityForPriority(state: GameState, player: PlayerId, source: ObjectId, abilityIndex: number): ApplyResult {
    const found = findActivatableAbility(state, player, source, abilityIndex);
    if (!found.ok) return fail(found.error);

    if (found.value.ability.isManaAbility) {
        return activateManaAbility(state, player, source, abilityIndex);
    } else {
        return beginActivation(state, player, source, abilityIndex, found.value.ability);
    }
}

export function beginActivation(state: GameState, player: PlayerId, source: ObjectId, abilityIndex: number, ability: AbilityOfKind<"activated">): ApplyResult {
    const activatable = checkActivatable(state, player, source, abilityIndex);
    if (!activatable.ok) return activatable;

    const rollback = state;
    const sourceSnapshot = snapshotSource(state, source);
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
        events: [{ type: "abilityActivateStart", player, abilitySource: source, sourceName: sourceSnapshot.chars.name, description: describeAbility(ability, sourceSnapshot.chars.name) }],
    };

    return continueCasting({ ...state, casting });
}
