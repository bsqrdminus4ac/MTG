import type { CardDefinition } from "@mtg/engine";

import { CREATURES } from "./cards/creatures";
import { INSTANTS } from "./cards/instants";
import { LANDS } from "./cards/lands";
import { SORCERIES } from "./cards/sorceries";
import { ACTIVATION_TEST_CARDS } from "./testCards/activation";
import { CONTINUOUS_TEST_CARDS } from "./testCards/continuous";
import { DECISION_TEST_CARDS } from "./testCards/decisions";
import { TARGETING_TEST_CARDS } from "./testCards/targeting";
import { TRIGGER_TEST_CARDS } from "./testCards/triggers";

// Individual cards (and each file's array) by name
export * from "./cards/creatures";
export * from "./cards/instants";
export * from "./cards/lands";
export * from "./cards/sorceries";
export * from "./testCards/activation";
export * from "./testCards/continuous";
export * from "./testCards/decisions";
export * from "./testCards/targeting";
export * from "./testCards/triggers";

export const DEFINITIONS: readonly CardDefinition[] = [...LANDS, ...CREATURES, ...INSTANTS, ...SORCERIES];
export const TEST_DEFINITIONS: readonly CardDefinition[] = [...ACTIVATION_TEST_CARDS, ...TARGETING_TEST_CARDS, ...DECISION_TEST_CARDS, ...TRIGGER_TEST_CARDS, ...CONTINUOUS_TEST_CARDS];
export const ALL_DEFINITIONS: readonly CardDefinition[] = [...DEFINITIONS, ...TEST_DEFINITIONS];
