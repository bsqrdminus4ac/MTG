import type { Action } from "./actions";
import type { DecisionId, ObjectId, PlayerId } from "./ids";

/**
 * A Decision is a question the engine asks one player. The engine stops, stores the question in
 * `state.pending`, and waits. The player replies with a Submission, the engine validates it
 * against the question, and then continues. Everything here is plain data, so it serializes,
 * replays, and renders in a UI without any engine-specific knowledge.
 *
 * Three shapes cover everything:
 *   - priority: "you have priority; here is every legal thing you can do"
 *   - yesNo:    a boolean question
 *   - choose:   pick between `min` and `max` of the listed options (chooseOne is min = max = 1)
 */

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** What an option refers to. UIs can look objects and players up in GameState to show them. */
export type ChoiceValue =
    | Readonly<{ kind: "object"; id: ObjectId }>
    | Readonly<{ kind: "player"; id: PlayerId }>
    | Readonly<{ kind: "index"; index: number }> // e.g. which mode of a modal spell
    | Readonly<{ kind: "ability"; id: ObjectId; index: number }>
    | Readonly<{ kind: "null" }>;

export interface Choice {
  /** Unique within its decision. This is what answers quote. */
  readonly id: string;
  /** Fallback display text. */
  readonly label: string;
  readonly value: ChoiceValue;
}

/** One legal move while holding priority. Choosing it runs `action` through the rules engine. */
export interface PriorityOption {
  readonly id: string;
  readonly label: string;
  readonly action: Action;
}

export const objectChoice = (id: ObjectId, label: string): Choice => ({
  id: `object:${id}`,
  label,
  value: { kind: "object", id },
});
export const playerChoice = (id: PlayerId, label: string): Choice => ({
  id: `player:${id}`,
  label,
  value: { kind: "player", id },
});
export const indexChoice = (index: number, label: string): Choice => ({
  id: `index:${index}`,
  label,
  value: { kind: "index", index },
});
export const manaAbilityChoice = (id: ObjectId, abilityIndex: number, label: string): Choice => ({
  id: `object:${id}#${abilityIndex}`,
  label,
  value: {kind: "ability", id, index: abilityIndex}
});
export const nullChoice = (id: string, label: string): Choice => ({
    id,
    label,
    value: { kind: "null" },
});

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/**
 * What the engine does once a yesNo or choose decision is answered. This is data rather than a
 * callback so a paused game can be saved, restored, and replayed. Add a variant here, and a
 * case in engine.ts `resume`, for each new kind of question.
 */
export type Continuation = Readonly<
    | { kind: "discardToHandSize" }
    | { kind: "cancelAbility" }
    | { kind: "selectAbilityTargets" }
    | { kind: "costPayment" }
    | { kind: "selectAttackers" }
    | { kind: "selectAttackTargets" }
    | { kind: "cancelAttacks" }
    | { kind: "selectBlockers"; blocker: ObjectId }
    | { kind: "cancelBlocks" }
    | { kind: "selectDamageOrder"; attacker: ObjectId }
>;

interface DecisionBase {
    readonly id: DecisionId;
    /** The player who must answer. */
    readonly player: PlayerId;
    /** Text to show the player. */
    readonly prompt: string;

    readonly onCancel?: Continuation | undefined;
}

export interface PriorityDecision extends DecisionBase {
  readonly kind: "priority";
  readonly options: readonly PriorityOption[];
}

export interface YesNoDecision extends DecisionBase {
  readonly kind: "yesNo";
  readonly then: Continuation;
}

export interface ChooseDecision extends DecisionBase {
  readonly kind: "choose";
  readonly options: readonly Choice[];
  readonly min: number;
  readonly max: number;
  readonly then: Continuation;
}

export interface OrderingDecision extends DecisionBase {
    readonly kind: "order";
    readonly options: readonly Choice[];
    readonly then: Continuation;
}

export type Decision = PriorityDecision | YesNoDecision | ChooseDecision | OrderingDecision;

export const priorityDecision = (spec: Omit<PriorityDecision, "kind">): PriorityDecision => ({
  kind: "priority",
  ...spec,
});

export const yesNo = (spec: Omit<YesNoDecision, "kind">): YesNoDecision => ({ kind: "yesNo", ...spec });

export function chooseMany(spec: Omit<ChooseDecision, "kind">): ChooseDecision {
  if (spec.min < 0 || spec.min > spec.max || spec.max > spec.options.length) {
    throw new Error(`Invalid selection bounds ${spec.min}..${spec.max} for ${spec.options.length} options`);
  }
  return { kind: "choose", ...spec };
}

export const chooseOne = (spec: Omit<ChooseDecision, "kind" | "min" | "max">): ChooseDecision =>
  chooseMany({ ...spec, min: 1, max: 1 });

export const orderingDecision = (spec: Omit<OrderingDecision, "kind">): OrderingDecision => ({ kind: "order", ...spec });

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export type Answer =
    | Readonly<{ kind: "priority"; option: string }>
    | Readonly<{ kind: "yesNo"; value: boolean }>
    | Readonly<{ kind: "choose"; selected: readonly string[] }>
    | Readonly<{ kind: "order"; order: readonly number[] }>
    | Readonly<{ kind: "cancel" }>;

/** The only thing a UI or AI sends to the engine. */
export interface Submission {
  readonly player: PlayerId;
  readonly decision: DecisionId;
  readonly answer: Answer;
}

export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: string }>;

const good = <T>(value: T): Result<T> => ({ ok: true, value });
const bad = (error: string): Result<never> => ({ ok: false, error });

// Validation turns a raw answer (ids and booleans) into the thing it refers to.

export function resolvePriorityAnswer(d: PriorityDecision, answer: Answer): Result<PriorityOption> {
  if (answer.kind !== "priority") return bad("Expected a priority answer");
  const option = d.options.find((o) => o.id === answer.option);
  return option ? good(option) : bad(`Not a legal option: ${answer.option}`);
}

export function resolveYesNoAnswer(_d: YesNoDecision, answer: Answer): Result<boolean> {
  return answer.kind === "yesNo" ? good(answer.value) : bad("Expected a yes or no answer");
}

export function resolveChooseAnswer(d: ChooseDecision, answer: Answer): Result<readonly Choice[]> {
  if (answer.kind !== "choose") return bad("Expected a selection");
  if (new Set(answer.selected).size !== answer.selected.length) {
    return bad("Each option can only be chosen once");
  }
  const chosen: Choice[] = [];
  for (const id of answer.selected) {
    const choice = d.options.find((o) => o.id === id);
    if (!choice) return bad(`Not one of the options: ${id}`);
    chosen.push(choice);
  }
  if (chosen.length < d.min || chosen.length > d.max) {
    return bad(d.min === d.max ? `Choose exactly ${d.min}` : `Choose between ${d.min} and ${d.max}`);
  }
  return good(chosen);
}

export function resolveOrderingAnswer(d: OrderingDecision, answer: Answer): Result<readonly number[]> {
    if (answer.kind !== "order") return bad("Expected an ordering answer");
    if (answer.order.length !== d.options.length) return bad("Ordering length doesn't match number of options");
    const n = answer.order.length;
    const seen = new Array<boolean>(n).fill(false);
    for (const x of answer.order) {
        if (!Number.isInteger(x) || x < 0 || x >= n || seen[x]) return bad(`Ordering doesn't have each index from 0 to ${n - 1} once each`);
        seen[x] = true;
    }
    return good(answer.order);
}

/** Is this answer acceptable for this decision? Handy for UIs that want to disable a Submit button. */
export function validateAnswer(d: Decision, answer: Answer): Result<null> {
  if (answer.kind === "cancel") return d.onCancel ? good(null) : bad("This decision cannot be canceled");
  const r =
      d.kind === "priority"
          ? resolvePriorityAnswer(d, answer)
          : d.kind === "yesNo"
            ? resolveYesNoAnswer(d, answer)
            : d.kind === "order"
              ? resolveOrderingAnswer(d, answer)
              : resolveChooseAnswer(d, answer);
  return r.ok ? good(null) : r;
}
