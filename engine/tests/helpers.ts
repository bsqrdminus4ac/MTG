import { type ContinuousEffect, type Duration, type EffectId, type GameState, type Modification, nextID, type ObjectId, type Timestamp } from "../src";

export function makeContinuousEffect(
    state: GameState,
    overrides: { source: ObjectId; affects: Readonly<{ kind: "object"; id: ObjectId }> | Readonly<{ kind: "allCreatures" }>; modification: Modification; duration: Duration },
): [nextState: GameState, effect: ContinuousEffect] {
    const [timeState, timestamp] = nextID<Timestamp>(state);
    const [effectState, effectId] = nextID<EffectId>(timeState);
    return [effectState, {
        id: effectId,
        timestamp,
        source: overrides.source,
        affects: overrides.affects,
        duration: overrides.duration,
        modification: overrides.modification
    }];
}
