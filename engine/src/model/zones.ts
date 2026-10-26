import { type ApplyResult, ok } from "../core/result";
import { assertNever, withEntry, without } from "../core/util";
import { getCardName } from "./characteristics";
import type { GameEvent } from "./events";
import { type ObjectId, type PlayerId, type Timestamp } from "./ids";
import type { GameObject, GameState } from "./state";
import type { Zone } from "./vocabulary";

function updateZone(state: GameState, owner: PlayerId, zone: Zone, fn: (list: readonly ObjectId[]) => readonly ObjectId[]): GameState {
    switch (zone) {
        case "battlefield":
            return { ...state, battlefield: fn(state.battlefield) };
        case "exile":
            return { ...state, exile: fn(state.exile) };
        case "stack":
            return state; // the stack holds StackEntry values, not bare ids
        case "library":
        case "hand":
        case "graveyard": {
            const player = state.players[owner];
            if (!player) return state;
            return {
                ...state,
                players: withEntry(state.players, owner, {
                    ...player,
                    [zone]: fn(player[zone]),
                }),
            };
        }
        default:
            return assertNever(zone);
    }
}

export interface MoveResult {
    readonly state: GameState;
    readonly newId: ObjectId;
    readonly events: readonly GameEvent[];
}

/**
 * Moves an object to another zone. Per CR 400.7 it becomes a brand-new object:
 * new id, fresh timestamp, and no memory of damage, counters, or tapped status.
 */
export function moveObject(state: GameState, id: ObjectId, to: Zone): MoveResult | null {
    const obj = state.objects[id];
    if (!obj) return null;

    const n = state.nextId;
    const newId = n as ObjectId;
    const moved: GameObject = {
        ...obj,
        id: newId,
        zone: to,
        controller: obj.owner,
        timestamp: n as Timestamp,
        tapped: false,
        damage: 0,
        counters: {},
        turnEnteredZone: state.turn.number,
    };

    let next = updateZone(state, obj.owner, obj.zone, (list) => list.filter((x) => x !== id));
    next = updateZone(next, obj.owner, to, (list) => [...list, newId]);
    next = {
        ...next,
        nextId: n + 1,
        objects: withEntry(without(next.objects, id), newId, moved),
        // Effects tied to the old object stop applying once it leaves.
        continuousEffects: next.continuousEffects.filter((e) => !(e.source === id && e.duration === "whileSourceOnBattlefield") && !(e.affects.kind === "object" && e.affects.id === id)),
    };

    return {
        state: next,
        newId,
        events: [
            {
                type: "cardMoved",
                from: obj.zone,
                to,
                oldId: id,
                newId,
                owner: obj.owner,
            },
        ],
    };
}

export function drawCardResult(state: GameState, player: PlayerId): ApplyResult {
    const draw = drawCard(state, player);
    return ok(draw.state, draw.events);
}

export function drawCard(state: GameState, player: PlayerId): { state: GameState; events: readonly GameEvent[] } {
    const p = state.players[player];
    if (!p) return { state, events: [] };

    const top = p.library[p.library.length - 1];
    if (top === undefined) {
        const marked = { ...p, drewFromEmptyLibrary: true };
        return {
            state: {
                ...state,
                players: withEntry(state.players, player, marked),
            },
            events: [],
        };
    }
    const moved = moveObject(state, top, "hand");
    if (!moved) return { state, events: [] };
    return {
        state: moved.state,
        events: [...moved.events, { type: "cardDrawn", player, card: moved.newId, cardName: getCardName(moved.state, moved.newId) }],
    };
}
