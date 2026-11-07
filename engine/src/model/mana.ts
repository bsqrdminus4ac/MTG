import type { PlayerState } from "./state";

export const COLORS = ["W", "U", "B", "R", "G"] as const;
export type Color = (typeof COLORS)[number];

/** Mana that can sit in a pool. "C" is colorless. */
export const MANA_TYPES = [...COLORS, "C"] as const;
export type ManaType = (typeof MANA_TYPES)[number];
export function isManaType(ch: string): ch is ManaType {
    return (MANA_TYPES as readonly string[]).includes(ch.toUpperCase());
}

export const parseCost = (c: string): ManaCost => {
    const match = /^(\d*)([A-Za-z]*)$/i.exec(c);
    if (!match) throw new Error(`Bad format: ${c}`);
    const n = match[1];
    const generic = n ? parseInt(n, 10) : 0;
    const colors = match[2];
    if (!colors) return { generic, pips: [] };
    const counts = Object.fromEntries(MANA_TYPES.map((l) => [l, 0])) as Record<ManaType, number>;
    for (const color of colors) {
        if (isManaType(color)) counts[color] = (counts[color] ?? 0) + 1;
    }
    const pips: ManaType[] = [];
    for (const type of MANA_TYPES) {
        pips.push(...Array(counts[type]).fill(type));
    }

    return { generic, pips };
};

/** Hybrid, Phyrexian, X and snow costs are intentionally left out for now. */
export interface ManaCost {
    readonly generic: number;
    readonly pips: readonly ManaType[];
}

export const colorIdentity = (cost: ManaCost): Color[] => [...new Set(cost.pips.flatMap((c) => (c === "C" ? [] : c)))];


export type ManaPool = Readonly<Record<ManaType, number>>;

export const emptyPool = (): ManaPool => ({
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
    C: 0,
});

export const manaValue = (cost: ManaCost | null): number => (cost === null ? 0 : cost.generic + cost.pips.length);

export const addMana = (player: PlayerState, mana: ManaType, amount: number): PlayerState => {
    return {
        ...player,
        manaPool: {
            ...player.manaPool,
            [mana]: (player.manaPool[mana] ?? 0) + amount,
        },
    };
};

export const totalManaPoolCount = (pool: ManaPool): number => Object.values(pool).reduce((a, b) => a + b, 0);

export const canPayMana = (manaPool: ManaPool, cost: ManaCost): boolean => {
    let generic = cost.generic;
    const pool = { ...manaPool };
    for (const pip of cost.pips) {
        if ((pool[pip] ?? 0) <= 0) return false;
        pool[pip]--;
    }

    const totalAvailable = Object.values(pool).reduce((a, b) => a + b, 0);
    return totalAvailable >= generic;
};

export const payMana = (player: PlayerState, cost: ManaCost): PlayerState | null => {
    let generic = cost.generic;
    const pool = { ...player.manaPool };

    for (const pip of cost.pips) {
        pool[pip]--;
        if (pool[pip] < 0) return null; // Not enough mana of this type
    }

    for (const [color, amount] of Object.entries(pool)) {
        // For now, we just use the first available mana in WUBRGC order to pay generic costs. This could be improved to allow the player to choose which mana to use.
        const amountToUse = Math.min(generic, amount);
        generic -= amountToUse;
        pool[color as ManaType] = amount - amountToUse;
        if (generic <= 0) break;
    }
    if (generic > 0) return null;

    return { ...player, manaPool: pool };
};
