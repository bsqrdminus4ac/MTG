import { type Result, badResult, goodResult } from "../core/result";
import type { AbilityOfKind, AbilityRef, ActivatableAbilityInfo } from "../model/abilities";
import type { Characteristics } from "../model/cardDefinition";
import { getAbilityByRef, getAllAbilities, getCharacteristics, hasCardType, hasKeyword } from "../model/characteristics";
import type { ObjectId, PlayerId } from "../model/ids";
import type { GameObject, GameState } from "../model/state";
import { canPlayInstantSpeed, canPlaySorcerySpeed } from "./timing";

export function findActivatableAbility(state: GameState, player: PlayerId, source: ObjectId, abilityRef: AbilityRef): Result<{ chars: Characteristics; ability: AbilityOfKind<"activated"> }> {
    const priority = state.priority;
    if (!priority || priority.holder !== player) return badResult("You don't have priority");
    const obj = state.objects[source];
    if (!obj) return badResult("That object is gone");
    const ability = getAbilityByRef(state, source, abilityRef);
    const chars = getCharacteristics(state, source);
    if (!chars || !ability) return badResult("That object doesn't have that ability");
    if (ability.kind !== "activated") return badResult("That ability isn't an activated ability");
    if (!canActivateAbility(state, player, obj, ability)) return badResult("You can't activate that ability right now");
    return goodResult({ chars, ability });
}

export function canActivateAbility(state: GameState, player: PlayerId, source: GameObject, ability: AbilityOfKind<"activated">): boolean {
    if (!source) return false;
    if (source.controller !== player) return false; // Could potentially have abilities that can be activated by other players, but not yet implemented
    if (!ability.activateableZones.includes(source.zone)) return false;
    if (ability.timingRestriction === "sorcerySpeed" && !canPlaySorcerySpeed(state, player)) return false;
    if (ability.timingRestriction === "instantSpeed" && !canPlayInstantSpeed(state, player)) return false;
    if (ability.cost.tap) {
        if (source.tapped) return false;
        if (hasCardType(state, source.id, "Creature") && source.turnEnteredZone === state.turn.number && !hasKeyword(state, source.id, "haste")) return false;
    }
    return true;
}

export function getAllActivatableAbilities(state: GameState, player: PlayerId, excludeSource?: ObjectId): ActivatableAbilityInfo[] {
    const options: ActivatableAbilityInfo[] = [];
    for (const obj of Object.values(state.objects)) {
        if (excludeSource && obj.id === excludeSource) continue;
        const abilities = getAllAbilities(state, obj.id);
        for (let i = 0; i < abilities.length; i++) {
            const abilityInfo = abilities[i];
            if (!abilityInfo) continue;
            if (abilityInfo.ability.kind === "activated" && canActivateAbility(state, player, obj, abilityInfo.ability)) {
                options.push({
                    source: obj.id,
                    ability: abilityInfo.ability,
                    ref: abilityInfo.ref,
                });
            }
        }
    }
    return options;
}