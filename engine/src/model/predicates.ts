import type { Color } from "./mana";
import type { CardType, Keyword, Supertype, Zone } from "./vocabulary";

export type ObjectPredicate = 
    | Readonly<{ kind: "hasType", type: CardType }>
    | Readonly<{ kind: "hasColor", color: Color }>
    | Readonly<{ kind: "hasSupertype", type: Supertype }>
    | Readonly<{ kind: "hasSubtype", type: string }>
    | Readonly<{ kind: "hasKeyword", keyword: Keyword }>
    | Readonly<{ kind: "controlledBy", who: "you" | "opponent" }>
    | Readonly<{ kind: "inZone", zone: Zone }>
    | Readonly<{ kind: "not", of: ObjectPredicate }>
    | Readonly<{ kind: "all", of: ObjectPredicate[] }>
    | Readonly<{ kind: "any", of: ObjectPredicate[] }>
    ;
