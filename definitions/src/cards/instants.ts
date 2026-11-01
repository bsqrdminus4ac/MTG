import { anyTarget, type CardDefinition } from "@mtg/engine";
import { instant } from "../builders/defineCard";

export const bolt = instant({
    name: "Lightning Bolt",
    cost: { generic: 0, pips: ["R"] },
    abilities: [
        {
            kind: "spell",
            targets: [
                {
                    filter: anyTarget(),
                    minCount: 1,
                    maxCount: 1,
                },
            ],
            effects: [{ kind: "damage", to: { kind: "target", spec: 0 }, amount: 3, description: "<this> deals 3 damage to any target." }],
        },
    ],
});

export const INSTANTS: readonly CardDefinition[] = [bolt];