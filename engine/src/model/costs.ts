import type { ManaCost } from "./mana";

export type CostComponent = 
    | Readonly<{ kind: "mana", cost: ManaCost}>
    | Readonly<{ kind: "tapSelf" }>
    | Readonly<{ kind: "sacrificeSelf" }>
    ;

export type Cost = readonly CostComponent[];

export type NonManaCost = Exclude<CostComponent, {kind: "mana"}>;