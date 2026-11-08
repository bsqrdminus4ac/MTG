import { type ContinuousEffect, type Duration, type EffectId, type GameState, type Modification, nextID, type ObjectId, type ObjectMatch, type PlayerId, type Timestamp } from "../src";
import type { CardDefinition } from "../src/model/cardDefinition";
import { moveObject } from "../src/model/zones";
import type { Zone } from "../src/model/vocabulary";

export function moveDefinition(state: GameState, player: PlayerId, definition: CardDefinition, zone: Zone) {
    const card = state.players[player]?.library.find((id) => state.objects[id]?.definitionId === definition.id);
    if (card === undefined) throw new Error(`Missing ${definition.name} in ${player}'s library`);
    const moved = moveObject(state, card, zone);
    if (!moved) throw new Error(`Unable to move ${definition.name}`);
    return moved;
}

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
