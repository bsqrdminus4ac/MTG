declare const brand: unique symbol;

/** Nominal typing for primitives, so a PlayerId can't be passed where an ObjectId is expected. */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type PlayerId = Brand<string, "PlayerId">;
export type CardDefId = Brand<string, "CardDefId">;
/** Identifies one object in the game. A new id is issued whenever an object changes zones (CR 400.7). */
export type ObjectId = Brand<number, "ObjectId">;
export type StackId = Brand<number, "StackId">;
/** Identifies one question the engine asked. Answers must quote it, so stale answers are rejected. */
export type DecisionId = Brand<number, "DecisionId">;
/** Higher = more recent. Orders continuous effects within a layer (CR 613.7). */
export type Timestamp = Brand<number, "Timestamp">;

export const playerId = (s: string): PlayerId => s as PlayerId;
export const cardDefId = (s: string): CardDefId => s as CardDefId;
