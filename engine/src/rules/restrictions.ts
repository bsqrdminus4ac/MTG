import { isTrue } from "../core/result";
import { addToMapArray, assertNever } from "../core/util";
import type { AbilityOfKind } from "../model/abilities";
import { getAllAbilities, getCardName, snapshotObject } from "../model/characteristics";
import { isRulesModification, type ObjectMatch, type PlayerMatch, type RulesModification } from "../model/continuous";
import { evalObjectPredicate, evalPlayerPredicate } from "../model/evalPredicates";
import type { ObjectId, PlayerId } from "../model/ids";
import { combineManaCosts, subtractManaCosts, type ManaCost } from "../model/mana";
import type { AttackableTarget, GameState } from "../model/state";
import type { Keyword } from "../model/vocabulary";

type RestrictionData = {
    source: ObjectId;
    sourceName: string;
    controller: PlayerId;
    affects: Readonly<{ kind: "objects"; ids: ObjectId[] }> | Readonly<{ kind: "self" }> | ObjectMatch | PlayerMatch;
    restriction: RulesModification;
    fromKeyword?: Keyword;
};

type RestrictionInfo = Map<RulesModification["kind"], RestrictionData[]>;

const restrictionCache = new WeakMap<GameState["objects"], WeakMap<GameState["continuousEffects"], RestrictionInfo>>();

export function cantAttackDueToRestriction(state: GameState, attacker: ObjectId, target?: AttackableTarget): boolean {
    const restrictions = getActiveRestrictions(state).get("cantAttack");
    if (!restrictions) return false;
    for (const restriction of restrictions) {
        if (restriction.restriction.kind !== "cantAttack") continue;
        if (restrictionAffectsObject(state, attacker, restriction)) {
            const targetFilter = restriction.restriction.who;
            if (!targetFilter) return true;
            if (targetFilter.kind === "object" && target?.kind === "object") {
                const targetSnapshot = snapshotObject(state, target.id);
                if (!targetSnapshot) continue;
                if (isTrue(evalObjectPredicate({ source: restriction.source, controller: restriction.controller, bindings: {} }, targetSnapshot, targetFilter.filter))) return true;
            } else if (targetFilter.kind === "player" && target?.kind === "player") {
                if (isTrue(evalPlayerPredicate(state, { source: restriction.source, controller: restriction.controller, bindings: {} }, target.id, targetFilter.filter))) return true;
            }
        }
    }
    return false;
}

export function cantBlockDueToRestriction(state: GameState, blocker: ObjectId, attacker: ObjectId): boolean {
    const restrictions = getActiveRestrictions(state).get("cantBlock");
    if (!restrictions) return false;
    for (const restriction of restrictions) {
        if (restriction.restriction.kind !== "cantBlock") continue;
        if (restrictionAffectsObject(state, blocker, restriction)) {
            if (!restriction.restriction.who) return true;
            const attackerSnapshot = snapshotObject(state, attacker);
            if (!attackerSnapshot) continue;
            if (isTrue(evalObjectPredicate({ source: restriction.source, controller: restriction.controller, bindings: {} }, attackerSnapshot, restriction.restriction.who))) return true;
        }
    }
    return false;
}

export function cantBeBlockedByDueToRestriction(state: GameState, attacker: ObjectId, blocker: ObjectId): boolean {
    const restrictions = getActiveRestrictions(state).get("cantBeBlocked");
    if (!restrictions) return false;
    for (const restriction of restrictions) {
        if (restriction.restriction.kind !== "cantBeBlocked") continue;
        if (restrictionAffectsObject(state, blocker, restriction)) {
            if (!restriction.restriction.by) return true;
            const blockerSnapshot = snapshotObject(state, blocker);
            if (!blockerSnapshot) continue;
            if (isTrue(evalObjectPredicate({ source: restriction.source, controller: restriction.controller, bindings: {} }, blockerSnapshot, restriction.restriction.by))) return true;
        }
    }
    return false;
}

export function cantBeTargetedByDueToRestriction(state: GameState, target: ObjectId, source: ObjectId): boolean {
    const restrictions = getActiveRestrictions(state).get("cantBeTargeted");
    if (!restrictions) return false;
    for (const restriction of restrictions) {
        if (restriction.restriction.kind !== "cantBeTargeted") continue;
        if (restrictionAffectsObject(state, target, restriction)) {
            if (!restriction.restriction.by) return true;
            const sourceSnapshot = snapshotObject(state, source);
            if (!sourceSnapshot) continue;
            if (isTrue(evalObjectPredicate({ source: restriction.source, controller: restriction.controller, bindings: {} }, sourceSnapshot, restriction.restriction.by))) return true;
        }
    }
    return false;
}

export function cantCastDueToRestriction(state: GameState, player: PlayerId, card: ObjectId): boolean {
    const restrictions = getActiveRestrictions(state).get("cantCast");
    if (!restrictions) return false;
    for (const restriction of restrictions) {
        if (restriction.restriction.kind !== "cantCast") continue;
        if (restrictionAffectsPlayer(state, player, restriction)) {
            if (!restriction.restriction.what) return true;
            const cardSnapshot = snapshotObject(state, card);
            if (!cardSnapshot) continue;
            if (isTrue(evalObjectPredicate({ source: restriction.source, controller: restriction.controller, bindings: {} }, cardSnapshot, restriction.restriction.what))) return true;
        }
    }
    return false;
}

export function cantActivateAbilityDueToRestriction(state: GameState, player: PlayerId, source: ObjectId, ability: AbilityOfKind<"activated">): boolean {
    const restrictions = getActiveRestrictions(state).get("cantActivateAbilities");
    if (!restrictions) return false;
    for (const restriction of restrictions) {
        if (restriction.restriction.kind !== "cantActivateAbilities") continue;
        if (restrictionAffectsPlayer(state, player, restriction)) {
            if (!restriction.restriction.includeManaAbilities && ability.isManaAbility) continue;
            if (!restriction.restriction.what) return true;
            const sourceSnapshot = snapshotObject(state, source);
            if (!sourceSnapshot) continue;
            if (isTrue(evalObjectPredicate({ source: restriction.source, controller: restriction.controller, bindings: {} }, sourceSnapshot, restriction.restriction.what))) return true;
        }
    }
    return false;
}

export function cantPlayLandDueToRestriction(state: GameState, player: PlayerId): boolean {
    const restrictions = getActiveRestrictions(state).get("cantPlayLands");
    if (!restrictions) return false;
    for (const restriction of restrictions) {
        if (restriction.restriction.kind === "cantPlayLands" && restrictionAffectsPlayer(state, player, restriction)) {
            return true;
        }
    }
    return false;
}

export function getTotalCostModifications(state: GameState, player: PlayerId, source: ObjectId, ability: AbilityOfKind<"spell" | "activated">, startingCost: ManaCost | null): ManaCost | null {
    const restrictions = getActiveRestrictions(state).get("modifyCost");
    if (!restrictions) return startingCost;
    const sourceSnapshot = snapshotObject(state, source);
    const increases: ManaCost[] = [];
    const reductions: ManaCost[] = [];
    for (const restriction of restrictions) {
        if (restriction.restriction.kind !== "modifyCost") continue;
        if (restriction.restriction.costOf !== ability.kind) continue;
        if (!restriction.restriction.includeManaAbilities && ability.kind === "activated" && ability.isManaAbility) continue;
        if (
            restrictionAffectsPlayer(state, player, restriction) &&
            (!restriction.restriction.what ||
                (sourceSnapshot && isTrue(evalObjectPredicate({ source: restriction.source, controller: restriction.controller, bindings: {} }, sourceSnapshot, restriction.restriction.what))))
        ) {
            if (restriction.restriction.increase) increases.push(restriction.restriction.increase);
            if (restriction.restriction.reduce) reductions.push(restriction.restriction.reduce);
        }
    }
    let currentCost = startingCost;
    currentCost = increases.reduce((total, next) => combineManaCosts(total, next), currentCost);
    currentCost = reductions.reduce((total, next) => subtractManaCosts(total, next), currentCost);
    return currentCost;
}

export function getActiveRestrictions(state: GameState): RestrictionInfo {
    let byEffects = restrictionCache.get(state.objects);
    if (!byEffects) {
        byEffects = new WeakMap();
        restrictionCache.set(state.objects, byEffects);
    }
    let result = byEffects.get(state.continuousEffects);
    if (!result) {
        result = computeRestrictions(state);
        byEffects.set(state.continuousEffects, result);
    }
    return result;
}

function computeRestrictions(state: GameState): RestrictionInfo {
    const restrictions: RestrictionInfo = new Map();
    state.continuousEffects.forEach((effect) =>
        effect.modifications.filter(isRulesModification).forEach((modification) => {
            addToMapArray(restrictions, modification.kind, { source: effect.source, sourceName: effect.sourceName, controller: effect.controller, affects: effect.affects, restriction: modification });
        }),
    );

    state.battlefield.forEach((objId) => {
        const abilities = getAllAbilities(state, objId);
        abilities.forEach((abilityInfo) => {
            if (abilityInfo.ability.kind === "keyword") {
                deriveRestrictionFromKeyword(state, restrictions, objId, abilityInfo.ability);
            } else if (abilityInfo.ability.kind === "static") {
                if (!(abilityInfo.ability.activeZones === "all" || abilityInfo.ability.activeZones.includes("battlefield"))) return;
                for (const modification of abilityInfo.ability.effect.modifications.filter(isRulesModification)) {
                    const obj = state.objects[objId];
                    if (!obj) return;
                    addToMapArray(restrictions, modification.kind, {
                        source: objId,
                        sourceName: getCardName(state, objId),
                        controller: obj.controller,
                        affects: abilityInfo.ability.effect.affects,
                        restriction: modification,
                    });
                }
            }
        });
    });
    return restrictions;
}

function deriveRestrictionFromKeyword(state: GameState, restrictions: RestrictionInfo, objId: ObjectId, ability: AbilityOfKind<"keyword">): void {
    const obj = state.objects[objId];
    if (!obj) return;
    if (ability.keyword === "defender") {
        addToMapArray(restrictions, "cantAttack", {
            source: objId,
            controller: obj.controller,
            sourceName: getCardName(state, objId),
            affects: { kind: "self" },
            restriction: { kind: "cantAttack" },
            fromKeyword: "defender",
        });
    } else if (ability.keyword === "flying") {
        addToMapArray(restrictions, "cantBeBlocked", {
            source: objId,
            controller: obj.controller,
            sourceName: getCardName(state, objId),
            affects: { kind: "self" },
            restriction: {
                kind: "cantBeBlocked",
                by: {
                    kind: "not",
                    of: {
                        kind: "any",
                        of: [
                            { kind: "hasKeyword", keyword: "flying" },
                            { kind: "hasKeyword", keyword: "reach" },
                        ],
                    },
                },
            },
            fromKeyword: "flying",
        });
    } else if (ability.keyword === "hexproof") {
        addToMapArray(restrictions, "cantBeTargeted", {
            source: objId,
            sourceName: getCardName(state, objId),
            controller: obj.controller,
            affects: { kind: "self" },
            restriction: {
                kind: "cantBeTargeted",
                by: {
                    kind: "controlledBy",
                    who: "opponent",
                },
            },
            fromKeyword: "hexproof",
        });
    }
}

function restrictionAffectsObject(state: GameState, objId: ObjectId, restriction: RestrictionData): boolean {
    switch (restriction.affects.kind) {
        case "self":
            return restriction.source === objId;
        case "objects":
            return restriction.affects.ids.includes(objId);
        case "matchingObjects": {
            const obj = state.objects[objId];
            if (!obj) return false;
            if (restriction.affects.zones && !restriction.affects.zones.includes(obj.zone)) return false;
            const snapshot = snapshotObject(state, objId);
            if (!snapshot) return false;
            return isTrue(evalObjectPredicate({ source: restriction.source, controller: restriction.controller, bindings: {} }, snapshot, restriction.affects.filter));
        }
        case "matchingPlayers":
            return false;
        default:
            return assertNever(restriction.affects);
    }
}

function restrictionAffectsPlayer(state: GameState, player: PlayerId, restriction: RestrictionData): boolean {
    if (restriction.affects.kind !== "matchingPlayers") return false;
    return isTrue(evalPlayerPredicate(state, { source: restriction.source, controller: restriction.controller, bindings: {} }, player, restriction.affects.filter));
}
