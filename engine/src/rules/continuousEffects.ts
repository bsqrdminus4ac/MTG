import { ok, type ApplyResult } from "../core/result";
import { partition } from "../core/util";
import type { EffectContext } from "../flow/effects";
import type { AppliedEffect, ContinuousEffect, Duration, Modification, ObjectMatch } from "../model/continuous";
import type { GameEvent } from "../model/events";
import { nextID, type EffectId, type ObjectId, type Timestamp } from "../model/ids";
import { getCachedCharacteristics, getMatchingObjects } from "../model/layers";
import type { GameState } from "../model/state";

function affectsLockedSet(modification: Modification): boolean {
    return true; // Currently only characteristics/controller modifications have been implemented, not any rules-changing modifications.
}

export function addContinuousEffect(state: GameState, ctx: EffectContext, effect: Omit<AppliedEffect, "affects"> & { affects: { kind: "objects"; ids: ObjectId[] } | ObjectMatch }): ApplyResult {
    if (effect.modifications.length === 0) return ok(state, []);
    if (effect.duration === "whileSourceOnBattlefield" && state.objects[ctx.source]?.zone !== "battlefield") return ok(state, []);

    const [lockedMods, rulesMods] = partition(effect.modifications, affectsLockedSet);

    const [timeState, timestamp] = nextID<Timestamp>(state); // Use same timestamp for both locked and rules effects if an effect has both
    let currentState = timeState;
    const out: GameEvent[] = [];

    if (lockedMods.length > 0) {
        const affects: { kind: "objects"; ids: ObjectId[] } =
            effect.affects.kind === "objects" ? effect.affects : { kind: "objects", ids: [...getMatchingObjects(currentState, getCachedCharacteristics(currentState), ctx, effect.affects)] };
        const [effectState, lockedId] = nextID<EffectId>(currentState);
        currentState = effectState;
        const lockedEffect: ContinuousEffect = {
            ...{
                id: lockedId,
                source: ctx.source,
                controller: ctx.controller,
                affects,
                modifications: lockedMods,
                duration: effect.duration,
                timestamp,
                sourceName: ctx.sourceSnapshot.chars.name,
            },
        };
        currentState = { ...currentState, continuousEffects: [...currentState.continuousEffects, lockedEffect] };
        out.push({ type: "continuousEffectCreated", effect: lockedEffect });
    }
    if (rulesMods.length > 0) {
        const [effectState, rulesId] = nextID<EffectId>(currentState);
        currentState = effectState;
        const rulesEffect: ContinuousEffect = {
            ...{
                id: rulesId,
                source: ctx.source,
                controller: ctx.controller,
                affects: effect.affects,
                modifications: rulesMods,
                duration: effect.duration,
                timestamp,
                sourceName: ctx.sourceSnapshot.chars.name,
            },
        };
        currentState = { ...currentState, continuousEffects: [...currentState.continuousEffects, rulesEffect] };
        out.push({ type: "continuousEffectCreated", effect: rulesEffect });
    }
    return ok(currentState, out);
}

export function expireEffects(state: GameState, duration: Duration, matching?: (e: ContinuousEffect) => boolean): ApplyResult {
    const [expired, remaining] = partition(state.continuousEffects, (e: ContinuousEffect) => e.duration === duration && (!matching || matching(e)));
    return ok(
        { ...state, continuousEffects: remaining },
        expired.map((e): GameEvent => ({ type: "continuousEffectExpired", effect: e })),
    );
}
