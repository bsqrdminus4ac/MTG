import type { Amount } from "./effects";
import type { ManaCost } from "./mana";
import type { ObjectPredicate } from "./predicates";

// model/costs.ts
type CostComponentOf<A> =
    | Readonly<{ kind: "mana"; cost: ManaCost }>
    | Readonly<{ kind: "tapSelf" }>
    | Readonly<{ kind: "sacrificeSelf" }>
    | Readonly<{ kind: "payLife"; amount: A }>
    | Readonly<{
          kind: "sacrifice";
          /** Already assumes that it is limited to permanents you control on the battlefield */
          what?: ObjectPredicate;
          amount: A;
          bindAs?: string;
      }>
    | Readonly<{ kind: "discard"; what?: ObjectPredicate; amount: A; bindAs?: string }>
    | Readonly<{ kind: "optional"; bindAs: string; prompt: string; cost: readonly CostComponentOf<A>[] }>;

export type CostComponent = CostComponentOf<Amount>; // what cards declare
export type NonManaCost = Exclude<CostComponent, { kind: "mana" }>;
export type ResolvedCostComponent = Exclude<CostComponentOf<number>, { kind: "optional" | "mana" }>; // what TotalCost and payCosts see
export type Cost = readonly CostComponent[];
export type ResolvedCost = readonly ResolvedCostComponent[];
