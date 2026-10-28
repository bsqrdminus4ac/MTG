

export type Zone = "library" | "hand" | "battlefield" | "graveyard" | "stack" | "exile";
export type CardType = "Artifact" | "Battle" | "Creature" | "Enchantment" | "Instant" | "Land" | "Planeswalker" | "Sorcery";
export type PermanentType = Exclude<CardType, "Instant" | "Sorcery">;
export type Supertype = "Basic" | "Legendary" | "Snow";
export type Keyword = "flying" | "firstStrike" | "doubleStrike" | "deathtouch" | "haste" | "lifelink" | "reach" | "trample" | "vigilance" | "menace" | "defender" | "hexproof" | "indestructible";

const DAMAGEABLE: Record<PermanentType, boolean> = {
    Creature: true,
    Planeswalker: true,
    Battle: true,
    Artifact: false,
    Enchantment: false,
    Land: false,
};

export const DAMAGEABLE_TYPES = (Object.keys(DAMAGEABLE) as PermanentType[]).filter((t) => DAMAGEABLE[t]);

export const STEPS = [
    "untap",
    "upkeep",
    "draw",
    "precombatMain",
    "beginningOfCombat",
    "declareAttackers",
    "declareBlockers",
    "combatDamage",
    "endOfCombat",
    "postcombatMain",
    "end",
    "cleanup",
] as const;

export type Step = (typeof STEPS)[number];
export type Phase = "beginning" | "precombatMain" | "combat" | "postcombatMain" | "ending";
export const PHASE_OF: Readonly<Record<Step, Phase>> = {
    untap: "beginning",
    upkeep: "beginning",
    draw: "beginning",
    precombatMain: "precombatMain",
    beginningOfCombat: "combat",
    declareAttackers: "combat",
    declareBlockers: "combat",
    combatDamage: "combat",
    endOfCombat: "combat",
    postcombatMain: "postcombatMain",
    end: "ending",
    cleanup: "ending",
};
