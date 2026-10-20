import { fail, ok, type ApplyResult } from "./engine";
import type { ObjectId, PlayerId } from "./ids";
import type { GameState } from "./state";
import { withEntry } from "./util";

export function damagePlayer(state: GameState, player: PlayerId, source: ObjectId, amount: number): ApplyResult {
    const p = state.players[player];
    if (!p) return fail("Invalid player to damage");
    return ok({...state, players: withEntry(state.players, player, {...p, life: p.life - amount} )}, [{type: "damageDealt", source, amount, target: {kind: "player", id: player} }]);
}1