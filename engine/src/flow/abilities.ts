import { type ApplyResult, applySequentially, fail, ok } from "../core/result";
import type { AbilityOfKind, ActivatableAbilityInfo } from "../model/abilities";
import { getCharacteristics } from "../model/characteristics";
import type { GameEvent } from "../model/events";
import type { ObjectId, PlayerId } from "../model/ids";
import type { GameState, SourceSnapshot } from "../model/state";
import { tapPermanent } from "../rules/primitives";
import { checkStateBasedActions } from "../rules/stateBasedActions";
import { canActivateAbility } from "../rules/timing";
import { executeEffect } from "./effects";
import { withPriorityDecision } from "./priority";

export function getAllActivatableAbilities(state: GameState, player: PlayerId): ActivatableAbilityInfo[] {
    const options: ActivatableAbilityInfo[] = [];
    for (const obj of Object.values(state.objects)) {
        const abilities = getCharacteristics(state, obj.id)?.abilities;
        if (!abilities) continue;
        for (let i = 0; i < abilities.length; i++) {
            const ability = abilities[i];
            if (!ability) continue;
            if (ability.kind === "activated" && canActivateAbility(state, player, obj, ability)) {
                options.push({
                    source: obj.id,
                    ability: ability,
                    abilityIndex: i,
                });
            }
        }
    }
    return options;
}

export function activateAbility(state: GameState, player: PlayerId, source: ObjectId, abilityIndex: number): ApplyResult {
    const priority = state.priority;
    if (!priority || priority.holder !== player) return fail("You don't have priority");

    const obj = state.objects[source];
    if (!obj || obj.controller !== player) return fail("That object isn't under your control"); // Technically some abilities can be activated by opponents, not worrying about that now
    const chars = getCharacteristics(state, source);
    if (!chars) return fail("That object is gone");
    const ability = chars.abilities[abilityIndex];
    if (!ability) return fail("That object doesn't have that ability");
    if (ability.kind !== "activated") return fail("That ability isn't an activated ability");
    if (!ability.activateableZones.includes(obj.zone)) return fail("That ability can't be activated from that zone");

    // If ability targets are required, we need to ask the player to choose them before we can put the ability on the stack.

    const sourceSnapshot: SourceSnapshot = {
        chars,
        controller: player,
        id: source,
        owner: obj.owner,
    };

    if ((!ability.targets || ability.targets.length === 0) && ability.cost.mana === null) {
        if (ability.isManaAbility) {
            // Mana abilities don't use the stack (CR 605). We just resolve it immediately.
            const payResult = payAbilityCosts(state, player, source, ability);
            if (!payResult.ok) return fail(payResult.error);
            const resolveResult = applySequentially(
                payResult.state,
                ability.effects
                    .filter((e) => e.kind === "addMana")
                    .map((e) => {
                        return (s) =>
                            executeEffect(
                                s,
                                {
                                    controller: player,
                                    source,
                                    sourceSnapshot,
                                    targets: [],
                                    legalTargets: [],
                                    bindings: {},
                                },
                                e,
                            );
                    }),
            );
            if (!resolveResult.ok) return fail(resolveResult.error);
            const next = {
                ...resolveResult.state,
                priority: { holder: player, consecutivePasses: 0 },
            };
            const event: GameEvent = {
                type: "abilityActivated",
                player: player,
                abilitySource: source,
                cardName: chars.name,
            };
            return ok(next, [...payResult.events, event, ...resolveResult.events]);
        }
    }

    return fail("That ability requires targets or mana costs, which are not yet implemented");
}

export function activateAbilityForPriority(state: GameState, player: PlayerId, source: ObjectId, abilityIndex: number): ApplyResult {
  const steps = [(state: GameState) => activateAbility(state, player, source, abilityIndex), (state: GameState) => checkStateBasedActions(state, [])];
  const next = applySequentially(state, steps);
  if (!next.ok) return next;
  return ok(withPriorityDecision(next.state), next.events);
}

function payAbilityCosts(state: GameState, player: PlayerId, source: ObjectId, ability: AbilityOfKind<"activated">): ApplyResult {
  let steps: ((state: GameState) => ApplyResult)[] = [];
  if (ability.cost.mana) {
    // TODO
  }
  if (ability.cost.tap) {
      steps.push((currentState: GameState) => tapPermanent(currentState, source));
  }
  if (ability.cost.sacrificeSelf) {
    // TODO
  }
  return applySequentially(state, steps);
}
