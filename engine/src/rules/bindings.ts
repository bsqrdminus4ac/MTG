import { badResult, goodResult, type Result } from "../core/result";
import type { ChoiceValue } from "../model/decisions";
import type { ObjectId, PlayerId } from "../model/ids";
import type { Binding, Bindings } from "../model/state";

const describeKind = (b: Binding): string =>
    typeof b === "number" ? "a number" : typeof b === "boolean" ? "a true/false flag" : "a list of choices";

export function getBinding(bindings: Bindings, name: string): Result<Binding> {
    const b = bindings[name];
    return b === undefined ? badResult(`Unbound name '${name}'`) : goodResult(b);
}

export function getNumberBinding(bindings: Bindings, name: string): Result<number> {
    const b = getBinding(bindings, name);
    if (!b.ok) return b;
    return typeof b.value === "number" ? goodResult(b.value) : badResult(`'${name}' is ${describeKind(b.value)}, expected a number`);
}

// Coerces a list of choices to its length, useful for returning how many things were selected
export function getCountBinding(bindings: Bindings, name: string): Result<number> {
    const b = getBinding(bindings, name);
    if (!b.ok) return b;
    return typeof b.value === "boolean" ? badResult(`'${name}' is ${describeKind(b.value)}, expected a number`) : typeof b.value === "number" ? goodResult(b.value) : goodResult(b.value.length);
}

export function getFlagBinding(bindings: Bindings, name: string): Result<boolean> { 
    const b = getBinding(bindings, name);
    if (!b.ok) return b;
    return typeof b.value === "boolean" ? goodResult(b.value) : badResult(`'${name}' is ${describeKind(b.value)}, expected a boolean`);
 }

export function getChoiceBinding(bindings: Bindings, name: string): Result<readonly ChoiceValue[]> {
    const b = getBinding(bindings, name);
    if (!b.ok) return b;
    return typeof b.value === "number" || typeof b.value === "boolean"
        ? badResult(`'${name}' is ${describeKind(b.value)}, expected a list of choices`)
        : goodResult(b.value);
}

export function getObjectIdsFromBinding(bindings: Bindings, name: string): Result<readonly ObjectId[]> {
    const list = getChoiceBinding(bindings, name);
    if (!list.ok) return list;
    const ids: ObjectId[] = [];
    for (const v of list.value) {
        if (v.kind !== "object") return badResult(`'${name}' contains a '${v.kind}' choice, expected only objects`);
        ids.push(v.id);
    }
    return goodResult(ids);
}

export function getPlayerIdsFromBinding(bindings: Bindings, name: string): Result<readonly PlayerId[]> {
    const list = getChoiceBinding(bindings, name);
    if (!list.ok) return list;
    const ids: PlayerId[] = [];
    for (const v of list.value) {
        if (v.kind !== "player") return badResult(`'${name}' contains a '${v.kind}' choice, expected only players`);
        ids.push(v.id);
    }
    return goodResult(ids);
}