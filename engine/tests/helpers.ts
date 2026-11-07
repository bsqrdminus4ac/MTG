import { type ContinuousEffect, type Duration, type EffectId, type GameState, type Modification, nextID, type ObjectId, type ObjectMatch, type PlayerId, type Timestamp } from "../src";

export function makeContinuousEffect(
    state: GameState,
    overrides: { source: ObjectId; controller: PlayerId; affects: Readonly<{ kind: "objects"; ids: ObjectId[] }> | ObjectMatch; modification: Modification; duration: Duration },
): [nextState: GameState, effect: ContinuousEffect] {
    const [timeState, timestamp] = nextID<Timestamp>(state);
    const [effectState, effectId] = nextID<EffectId>(timeState);
    return [
        effectState,
        {
            id: effectId,
            timestamp,
            controller: overrides.controller,
            source: overrides.source,
            affects: overrides.affects,
            duration: overrides.duration,
            modifications: [overrides.modification],
        },
    ];
}
