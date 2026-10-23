import type { GameState, ObjectId, PlayerId, PlayerState } from "@mtg/engine";
import { describePool } from "../describe";
import { Bullets } from "./Bullets";
import { ObjectCard } from "./ObjectCard";
import { ZoneBox } from "./ZoneBox";

interface PlayerPanelProps {
  readonly state: GameState;
  readonly player: PlayerState;
  /** Seat number, only used to color the panel. */
  readonly seat: number;
  readonly forcePassEnabled: boolean;
  readonly forcePassAvailable: boolean;
  readonly onToggleForcePass: (player: PlayerId) => void;
}

/** Everything that belongs to one player: their numbers, plus a container for each of their zones. */
export function PlayerPanel({ state, player, seat, forcePassEnabled, forcePassAvailable, onToggleForcePass }: PlayerPanelProps) {
  const isActive = state.turn.activePlayer === player.id;
  const holdsPriority = state.priority?.holder === player.id;
  const mustDecide = state.pending?.player === player.id;

  // The battlefield and exile are shared lists in GameState, so split them up here. Permanents are
  // grouped by who controls them (an owner badge appears on the card if control has changed).
  const battlefield = state.battlefield.filter((id) => state.objects[id]?.controller === player.id);
  const exile = state.exile.filter((id) => state.objects[id]?.owner === player.id);

  // The last element is the top of the library and graveyard, so show those newest-first.
  const library = [...player.library].reverse();
  const graveyard = [...player.graveyard].reverse();

  const cards = (ids: readonly ObjectId[], markTop = false) =>
    ids.map((id, i) => <ObjectCard key={id} state={state} id={id} tag={markTop && i === 0 ? "top" : undefined} />);

  return (
    <section className="player" data-seat={seat % 2} aria-label={`Player ${player.id}`}>
      <header>
        <h2>{player.id}</h2>
        {isActive && <span className="badge accent">active player</span>}
        {holdsPriority && <span className="badge">has priority</span>}
        {mustDecide && <span className="badge hot">must decide</span>}
        <button
          type="button"
          className={forcePassEnabled ? "force-pass-enabled" : undefined}
          onClick={() => onToggleForcePass(player.id)}
          disabled={!forcePassEnabled && !forcePassAvailable}
          title={
            forcePassEnabled
              ? `Stop automatically passing for ${player.id}.`
              : `Automatically pass ${player.id}'s priority decisions for the rest of this turn. Stops if another player puts something on the stack, attacks, or an error occurs.`
          }
        >
          {forcePassEnabled ? "Stop force pass" : "Force pass"}
        </button>
      </header>

      <Bullets
        items={[
          ["Life", String(player.life)],
          ["Mana pool", describePool(player.manaPool)],
          ["Lands played this turn", String(player.landsPlayedThisTurn)],
          ["Drew from empty library", player.drewFromEmptyLibrary ? "yes" : "no"],
        ]}
      />

      <ZoneBox title="Hand" count={player.hand.length}>
        {cards(player.hand)}
      </ZoneBox>
      <ZoneBox title="Battlefield" note="permanents this player controls" count={battlefield.length}>
        {cards(battlefield)}
      </ZoneBox>
      <ZoneBox title="Graveyard" note="top first" count={graveyard.length}>
        {cards(graveyard, true)}
      </ZoneBox>
      <ZoneBox title="Library" note="top first" count={library.length} defaultOpen={false}>
        {cards(library, true)}
      </ZoneBox>
      <ZoneBox title="Exile" note="cards this player owns" count={exile.length} defaultOpen={false}>
        {cards(exile)}
      </ZoneBox>
    </section>
  );
}
