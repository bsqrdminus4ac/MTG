import type { CardDefinition } from "@mtg/engine";
import { expect, test } from "vitest";
import * as creatures from "./cards/creatures";
import * as instants from "./cards/instants";
import * as lands from "./cards/lands";
import * as sorceries from "./cards/sorceries";
import * as activation from "./testCards/activation";
import * as decisions from "./testCards/decisions";
import * as targeting from "./testCards/targeting";
import { ALL_DEFINITIONS, DEFINITIONS, TEST_DEFINITIONS } from "./index";

function isCardDefinition(value: unknown): value is CardDefinition {
    return typeof value === "object" && value !== null && "id" in value && "abilities" in value;
}

test("every exported card is registered, and ids are unique", () => {
    const all = [...DEFINITIONS, ...TEST_DEFINITIONS];
    const exported = Object.values({ ...lands, ...creatures, ...instants, ...sorceries, ...activation, ...decisions, ...targeting }).filter(isCardDefinition);
    for (const card of exported) expect(all).toContain(card);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    expect(ALL_DEFINITIONS).toEqual(all);
});