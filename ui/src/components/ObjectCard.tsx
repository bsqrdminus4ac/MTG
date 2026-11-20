import { abilityText, capitalize, getAppliedEffects, getCharacteristics, manaValue, type Characteristics, type Cost, type GameState, type ModificationInfo, type ObjectId } from "@mtg/engine";
import { describeAllEffects, describeContinuousEffect, describeCost, describeDuration, describeModification, manaCostFromCost } from "../describe";
import { Bullets, NestedList, type BulletItem } from "./Bullets";

interface ObjectCardProps {
    readonly state: GameState;
    readonly id: ObjectId;
    /** Extra badge in the summary line, e.g. "top". */
    readonly tag?: string | undefined;
}

const orDash = (words: readonly string[]): string => (words.length > 0 ? words.join(" ") : "—");

const withPrintedValue = (effective: string, printed: string): string => (effective === printed ? effective : `${effective} (printed ${printed})`);
const powerToughness = (power: number | null, toughness: number | null) => (power !== null && toughness !== null ? `${power}/${toughness}` : "—");
const typeLine = (characteristics: Characteristics) =>
    orDash([...characteristics.supertypes, ...characteristics.types]) + (characteristics.subtypes.length > 0 ? ` — ${characteristics.subtypes.join(" ")}` : "");
const colors = (characteristics: Characteristics) => (characteristics.colors.length > 0 ? characteristics.colors.join("") : "colorless");

function describeAppliedEffect(effect: ModificationInfo): string {
    let duration: string = "";
    if (effect.grantOrigin.kind === "effect") {
        duration = effect.duration ? describeDuration(effect.duration) : "";
    }
    return `From ${effect.sourceName} (${effect.layer} layer)${duration === "" ? "" : `, ${duration}`}: ${describeModification(effect.modification)}`;
}

function costComponentDescriptions(cost: Cost | null): string[] {
    if (cost === null) return ["—"];
    return cost.length > 0 ? cost.map(describeCost).map((s) => s.replaceAll(/[{}]/g, "")) : ["no cost"];
}

export function CostDisplay({ cost, printedCost }: { readonly cost: Cost | null; readonly printedCost: Cost | null }) {
    const effectiveParts = costComponentDescriptions(cost);
    const printedParts = costComponentDescriptions(printedCost);
    const usedPrinted = new Set<number>();
    const parts: { readonly description: string; readonly printed: string | null; readonly added: boolean }[] = [];

    for (const description of effectiveParts) {
        const exactMatch = printedParts.findIndex((part, index) => part === description && !usedPrinted.has(index));
        if (exactMatch >= 0) {
            usedPrinted.add(exactMatch);
            parts.push({ description, printed: null, added: false });
        } else {
            parts.push({ description, printed: null, added: true });
        }
    }

    let nextUnmatchedPrinted = 0;
    for (const [index, part] of parts.entries()) {
        if (!part.added) continue;
        while (nextUnmatchedPrinted < printedParts.length && usedPrinted.has(nextUnmatchedPrinted)) {
            nextUnmatchedPrinted++;
        }
        if (nextUnmatchedPrinted < printedParts.length) {
            const printedDescription = printedParts[nextUnmatchedPrinted];
            if (printedDescription !== undefined) {
                parts[index] = {
                    description: part.description,
                    printed: printedDescription,
                    added: false,
                };
                usedPrinted.add(nextUnmatchedPrinted);
                nextUnmatchedPrinted++;
            }
        }
    }

    const rendered = parts.map((part, index) => (
        <span key={index}>
            {index > 0 && ", "}
            {part.added ? <em>{part.description}</em> : part.description}
            {part.printed !== null && <small> (printed {part.printed})</small>}
        </span>
    ));
    for (let index = 0; index < printedParts.length; index++) {
        if (!usedPrinted.has(index)) {
            rendered.push(
                <span key={`printed-${index}`}>
                    {rendered.length > 0 && ", "}—<small> (printed {printedParts[index]})</small>
                </span>,
            );
        }
    }
    return <>{rendered}</>;
}

/** One game object as a collapsible element: a summary line, and its properties as bullets when opened. */
export function ObjectCard({ state, id, tag }: ObjectCardProps) {
    const obj = state.objects[id];
    if (!obj) {
        return (
            <div className="obj missing" role="alert">
                Missing object #{id}: a zone lists it, but state.objects does not
            </div>
        );
    }

    const chars = getCharacteristics(state, id);
    const printed = state.definitions[obj.definitionId];
    const objectName = chars?.name ?? "Unknown card";
    const counters = Object.entries(obj.counters);
    const isCreature = chars?.types.includes("Creature") ?? false;
    const cardText = chars?.abilities.map((ability) => abilityText(ability, objectName)) ?? [];
    const effects = state.continuousEffects.filter((e) => (e.affects.kind === "objects" ? e.affects.ids.includes(id) : obj.zone === "battlefield" && isCreature));
    const appliedEffects = getAppliedEffects(state, id) ?? [];

    const items: BulletItem[] = [
        ["Object ID", `#${id}`],
        ["Definition", obj.definitionId],
        ["Owner", obj.owner],
        ["Controller", obj.controller],
        ["Zone", obj.zone],
        ["Timestamp", String(obj.timestamp)],
        ["Tapped", obj.tapped ? "yes" : "no"],
        ["Damage", String(obj.damage)],
        ["Counters", counters.length > 0 ? counters.map(([kind, n]) => `${kind} ×${n}`).join(", ") : "none"],
    ];

    if (chars) {
        const effectivePT = powerToughness(chars.power, chars.toughness);
        const printedPT = printed ? powerToughness(printed.power, printed.toughness) : effectivePT;
        items.push(
            ["Type line", withPrintedValue(typeLine(chars), printed ? typeLine(printed) : typeLine(chars))],
            ["Colors", withPrintedValue(colors(chars), printed ? colors(printed) : colors(chars))],
            ["Cost", <CostDisplay key="mana-cost" cost={chars.cost} printedCost={printed ? printed.cost : chars.cost} />],
            ["Mana value", String(manaValue(manaCostFromCost(chars.cost)))],
            ["Power / toughness", withPrintedValue(effectivePT, printedPT)],
        );
        if (cardText.length > 0) {
            items.push(["Card Text", <NestedList key="card-text" items={cardText} />]);
        }
        items.push(["Abilities", <NestedList key="effects" items={chars.abilities.map((a) => capitalize(describeAllEffects(a)))} />]);
        items.push(["Active effects", <NestedList key="effects" items={effects.map((e) => capitalize(describeContinuousEffect(state, e)))} />]);
        items.push(["All applied effects", appliedEffects.length > 0 ? <NestedList key="applied-effects" items={appliedEffects.map(describeAppliedEffect)} /> : "none"]);
    } else {
        items.push(["Characteristics", "definition not found in state.definitions"]);
    }

    return (
        <details className="obj">
            <summary>
                <span className="obj-summary-main">
                    <span className="obj-summary-topline">
                        <span className="obj-title">
                            <span className="name">{objectName}</span>
                            <span className="id">#{id}</span>
                        </span>
                        <span className="obj-summary-statuses">
                            {tag !== undefined && <span className="badge accent">{tag}</span>}
                            {chars?.power != null && chars.toughness != null && (
                                <span className="badge">
                                    {withPrintedValue(
                                        powerToughness(chars.power, chars.toughness),
                                        printed ? powerToughness(printed.power, printed.toughness) : powerToughness(chars.power, chars.toughness),
                                    )}
                                </span>
                            )}
                            {obj.tapped && <span className="badge warn">tapped</span>}
                            {obj.damage > 0 && <span className="badge warn">{obj.damage} damage</span>}
                            {counters.length > 0 && <span className="badge">counters</span>}
                            {obj.controller !== obj.owner && <span className="badge warn">controlled by {obj.controller}</span>}
                        </span>
                    </span>
                    {cardText.length > 0 && <span className="obj-card-text">{cardText.join("\n")}</span>}
                </span>
            </summary>
            <Bullets items={items} />
        </details>
    );
}
