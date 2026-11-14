import { abilityText, capitalize, getAppliedEffects, getCharacteristics, manaValue, type Characteristics, type GameState, type ModificationInfo, type ObjectId } from "@mtg/engine";
import { describeAllEffects, describeContinuousEffect, describeDuration, describeManaCost, describeModification } from "../describe";
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
            ["Mana cost", describeManaCost(chars.manaCost)],
            ["Mana value", String(manaValue(chars.manaCost))],
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
