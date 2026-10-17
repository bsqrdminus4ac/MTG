export const COLORS = ["W", "U", "B", "R", "G"] as const;
export type Color = (typeof COLORS)[number];

/** Mana that can sit in a pool. "C" is colorless. */
export type ManaType = Color | "C";

/** Hybrid, Phyrexian, X and snow costs are intentionally left out for now. */
export interface ManaCost {
  readonly generic: number;
  readonly pips: readonly ManaType[];
}

export type ManaPool = Readonly<Record<ManaType, number>>;

export const emptyPool = (): ManaPool => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });

export const manaValue = (cost: ManaCost | null): number =>
  cost === null ? 0 : cost.generic + cost.pips.length;
