import type { CardType, Characteristics, Effect, TargetSpec } from "./cards";
import { getCardName, getCharacteristics, isPermanentType } from "./characteristics";
import { chooseMany, chooseOne, manaAbilityChoice, objectChoice, playerChoice, yesNo, type Choice } from "./decisions";
import { damageObject, damagePlayer } from "./effects";
import { applySequentially, fail, ok, type ApplyResult } from "./engine";
import type { GameEvent } from "./events";
import type { PlayerId, ObjectId } from "./ids";
import { canPayMana, type ManaCost } from "./mana";
import { getAllManaSources, openDecision } from "./prompts";
import type { Target, GameState, SpellOnStack } from "./state";
import { commitSpell, moveObject } from "./zones";

export interface CastingInProgress {
    player: PlayerId;
    card: ObjectId; // still in hand until commit
    targets: readonly Target[];
    targetSpecsSelected: readonly boolean[];
    cost: ManaCost | null; // total cost, determined after targets
    rollback: GameState; // state before casting began
    events: readonly GameEvent[]; // buffered until commit
}

export function beginCast(state: GameState, player: PlayerId, card: ObjectId): ApplyResult {
    const rollback = state;
    const spellInfo = getCharacteristics(state, card);
    if (!spellInfo) return fail(`Unable to get characteristics of #${card}`);
    let targetSpecs: boolean[] = [];
    if (!spellInfo.types.some((t) => isPermanentType(t))) {
        const spellAbilities = spellInfo.abilities;
        const spell = spellAbilities?.find((a) => a.kind === "spell");
        if (!spell) return fail("This card has no spell abilities to cast");
        targetSpecs = new Array(spell.targets.length).fill(false);
    }
    let currentState: GameState = {
        ...state,
        casting: {
            player,
            card,
            targets: [],
            targetSpecsSelected: targetSpecs,
            cost: null,
            rollback,
            events: [{ type: "spellCastStart", player, card, cardName: spellInfo.name }],
        },
    };
    if (targetSpecs.length === 0) {
        // No targets, skip to mana payment step
        return payManaOptions(currentState);
    } else {
        return selectTargetOptions(currentState);
    }
}

export function cancelCast(state: GameState): ApplyResult {
    if (!state.casting) return fail("No casting in progress to cancel");
    return ok(state.casting.rollback, [
        ...state.casting.events,
        {
            type: "spellCastCancelled",
            player: state.casting.player,
            card: state.casting.card,
            cardName: getCardName(state, state.casting.card),
        },
    ]);
}

export function commitCast(state: GameState): ApplyResult {
    return commitSpell(state);
}

export function selectTargetOptions(state: GameState): ApplyResult {
    if (!state.casting) return fail("No casting in progress to cancel");
    if (state.casting.targetSpecsSelected.length === 0) return fail("Entered target selection with no target specification for the selected spell");
    const player = state.casting.player;
    const card = state.casting.card;
    const nextSpecIndex = state.casting.targetSpecsSelected.indexOf(false);
    if (nextSpecIndex === -1) {
        // Targets have all been selected, go to mana payment step
        return payManaOptions(state);
    }
    const chars = getCharacteristics(state, card);
    const spellAbilities = chars?.abilities;
    const spell = spellAbilities?.find((a) => a.kind === "spell");
    if (!spell) return fail("This card has no spell abilities to cast");
    const nextSpec = spell.targets[nextSpecIndex];
    if (!nextSpec) return fail("Invalid TargetSpec to select targets for");
    const legalTargets = getLegalTargets(state, player, nextSpec);

    const options: Choice[] = [];
    for (const target of legalTargets) {
        if (target.kind === "player") {
            options.push(playerChoice(target.id, `Target player ${target.id} with ${chars?.name}`));
        } else if (target.kind === "object") {
            const targetChars = getCharacteristics(state, target.id);
            if (!targetChars) continue;
            options.push(objectChoice(target.id, `Target object ${targetChars.name} (#${target.id}) with ${chars?.name}`));
        }
    }
    const nextState = openDecision(state, (id) =>
        chooseMany({
            id,
            options: options,
            prompt: buildTargetPrompt(card, chars?.name!, spell.targets, nextSpec),
            min: nextSpec.minCount,
            max: nextSpec.maxCount,
            player: player,
            then: { kind: "selectAbilityTargets" },
            onCancel: { kind: "cancelAbility" },
        }),
    );

    return ok(nextState, []);
}

export function applyTargetSelections(state: GameState, targets: Target[]): ApplyResult {
    if (!state.casting) return fail("No casting in progress to set targets for");
    if (state.casting.targetSpecsSelected.length === 0) return fail("Selected targets with no target specification defined for the selected spell");
    const casting = state.casting;
    const selectedSpecIndex = casting.targetSpecsSelected.indexOf(false);
    const newSpecs = [...casting.targetSpecsSelected.slice(0, selectedSpecIndex), true, ...casting.targetSpecsSelected.slice(selectedSpecIndex + 1)];
    const nextState: GameState = {
        ...state,
        casting: {
            ...casting,
            targetSpecsSelected: newSpecs,
            targets: [...casting.targets, ...targets],
        },
    };
    return selectTargetOptions(nextState);
}

function buildTargetPrompt(card: ObjectId, cardName: string, specs: TargetSpec[], spec: TargetSpec): string {
    let prompt = "Select ";
    if (spec.minCount === 1 && spec.maxCount === 1) {
        prompt += "the target ";
    } else if (spec.minCount === spec.maxCount) {
        prompt += `${spec.minCount} targets `;
    } else {
        prompt += `between ${spec.minCount} and ${spec.maxCount} targets `;
    }
    if (specs.length !== 1) {
        prompt += `of type ${spec.kind} `;
    }
    prompt += `for spell ${cardName} (#${card})`;
    return prompt;
}

export function getLegalTargets(state: GameState, player: PlayerId, targetSpec: TargetSpec): readonly Target[] {
    let targets: Target[] = [];
    const isAnyTarget = targetSpec.kind === "AnyTarget";

    if (targetSpec.kind === "StackAbility") {
        for (const stackEntry of state.stack) {
            if (stackEntry.kind === "spell") {
                continue; // These already get caught by the object loop above
            }
            targets.push({ kind: "stackEntry", id: stackEntry.id });
        }
        return targets;
    }

    if (targetSpec.kind === "Player" || isAnyTarget) {
        for (const p of Object.values(state.players)) {
            // Worry about hexproof players later
            targets.push({ kind: "player", id: p.id });
        }
    }

    if (targetSpec.kind == "Player") return targets;

    for (const obj of Object.values(state.objects)) {
        const characteristics = getCharacteristics(state, obj.id);
        if (!characteristics) continue;
        if (targetSpec.zone !== obj.zone) continue;
        if (
            (targetSpec.kind === "AnyTarget" && isValidForAnyTarget(characteristics.types)) ||
            (targetSpec.kind == "Permanent" && (targetSpec.allowedTypes === "any" || targetSpec.allowedTypes.some((type) => characteristics.types.includes(type))))
        ) {
            targets.push({ kind: "object", id: obj.id });
        }
    }

    return targets;
}

function isValidForAnyTarget(types: readonly CardType[]): boolean {
    return types.some((type) => type === "Creature" || type === "Planeswalker" || type === "Battle");
}

// No real logic for now, could add logic around target decisions changing costs later
function calculateFinalCost(state: GameState, player: PlayerId, card: ObjectId): ManaCost | null {
    if (!state?.casting) return null;
    const obj = getCharacteristics(state, card);
    if (!obj) return null;
    return obj.manaCost;
}

export function payManaOptions(state: GameState): ApplyResult {
    if (!state.casting) return fail("No casting in progress to pay for");
    const casting = state.casting;
    const player = casting.player;
    const card = casting.card;
    const cost = casting.cost ?? calculateFinalCost(state, player, card);
    if (!cost) return fail("Invalid mana cost for spell");
    const nextState: GameState = casting.cost === cost ? state : { ...state, casting: { ...casting, cost } };

    const p = nextState.players[player];
    if (!p) return fail("Invalid player");
    const cardName = getCharacteristics(nextState, card)?.name;
    if (canPayMana(p.manaPool, cost)) {
        const decisionState = openDecision(nextState, (id) =>
            yesNo({
                id: id,
                player: player,
                prompt: `Pay mana to cast ${cardName}?`,
                then: { kind: "costPayment" },
            }),
        );
        return ok(decisionState, []);
    }

    const manaAbilities = getAllManaSources(nextState, player);
    if (manaAbilities.length === 0) return fail("Not enough mana abilities left to pay for this spell");
    const options = manaAbilities.map((ability) =>
        manaAbilityChoice(ability.source, ability.abilityIndex, ability.ability.description ?? `Ability #${ability.abilityIndex + 1} of ${getCharacteristics(nextState, ability.source)?.name}`),
    );
    const decisionState = openDecision(nextState, (id) =>
        chooseOne({
            id,
            options,
            player,
            prompt: `Add mana to cast ${cardName}`,
            then: { kind: "costPayment" },
            onCancel: { kind: "cancelAbility" },
        }),
    );
    return ok(decisionState, []);
}

export function resolveSpell(state: GameState, spell: SpellOnStack): ApplyResult {
    const spellInfo = getCharacteristics(state, spell.source);
    if (!spellInfo) return fail("This spell's card no longer exists");
    const isPermanentSpell = spellInfo.types.some((t) => isPermanentType(t));
    if (isPermanentSpell) {
        const moveResult = moveObject(state, spell.source, "battlefield");
        if (!moveResult) return fail("Unable to move permanent from stack to battlefield");
        return ok(moveResult.state, moveResult.events);
    }
    const steps = spellInfo.abilities.flatMap((ability) =>
        ability.kind === "spell" ? ability.effects.map((effect) => (currentState: GameState) => resolveEffect(currentState, spell.source, effect, spell.targets)) : [],
    );
    return applySequentially(state, steps);
}

function resolveEffect(state: GameState, source: ObjectId, effect: Effect, targets: readonly Target[]): ApplyResult {
    let currentState = state;
    let events: GameEvent[] = [];
    switch (effect.kind) {
        case "damage": {
            if (effect.to.kind === "player") {
                for (const targetPlayer of targets.filter((t) => t.kind === "player")) {
                    const result = damagePlayer(currentState, targetPlayer.id, source, effect.amount, false);
                    if (!result.ok) return result;
                    currentState = result.state;
                    events.push(...result.events);
                }
                return ok(currentState, events);
            } else if (effect.to.kind === "target") {
                const target = targets[effect.to.index];
                if (!target) {
                    return fail(`Invalid target index (${effect.to.index}) to damage`);
                }
                if (target.kind === "player") {
                    return damagePlayer(currentState, target.id, source, effect.amount, false);
                } else if (target.kind === "object") {
                    return damageObject(currentState, target.id, source, effect.amount, false);
                } else {
                    return fail("Damage cannot be dealt to spells/abilities on the stack");
                }
            } else {
                return fail("Damaging non-players is not implemented yet");
            }
        }
        default:
            return fail(`Resolving effects of kind ${effect.kind} is not implemented yet`);
    }
}
