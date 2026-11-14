import {
    abilityText,
    getAbilityByRef,
    getCharacteristics,
    type Ability,
    type AbilityRef,
    type Action,
    type Amount,
    type Answer,
    type AppliedEffect,
    type ChoiceValue,
    type Comparison,
    type Condition,
    type ContinuousEffect,
    type Cost,
    type Decision,
    type Duration,
    type Effect,
    type EffectTarget,
    type EventLeaf,
    type EventPredicate,
    type GameEvent,
    type GameState,
    type ManaCost,
    type ManaPool,
    type ManaType,
    type Modification,
    type ObjectId,
    type ObjectPredicate,
    type PlayerPredicate,
    type StackId,
    type StaticEffect,
    type Target,
    type TargetFilter,
    type TargetSpec,
    type Zone,
} from "@mtg/engine";
import { refKey } from "../../engine/src/model/layers";
import { getAbilityForSpell } from "../../engine/src/rules/stack";

function unreachable(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/** A card's name, or "#id" when the object no longer exists (e.g. it changed zones since an event). */
export const nameOf = (state: GameState, id: ObjectId, includeId?: boolean): string => {
  const name = getCharacteristics(state, id)?.name;
  if (name) {
    return includeId ? `${name} (#${id})` : name;
  } else {
    return `#${id}`;
  }
}

export const nameOfStackEntry = (state: GameState, id: StackId, includeId?: boolean): string => {
    const stackEntry = state.stack.find((entry) => entry.id === id);
    if (stackEntry) {
        const name = getCharacteristics(state, stackEntry.source)?.name;
        if (name) return includeId ? `${name} (stack entry #${id})` : name; // TODO: Handle abilities, not just spells
    }
    return `Stack entry #${id}`;
};

// ---------------------------------------------------------------------------
// Card data
// ---------------------------------------------------------------------------

export function describeManaCost(cost: ManaCost | null): string {
  if (cost === null) return "—";
  const generic = cost.generic > 0 || cost.pips.length === 0 ? `{${cost.generic}}` : "";
  return generic + cost.pips.map((p) => `{${p}}`).join("");
}

export function describePool(pool: ManaPool): string {
  const parts = Object.entries(pool)
    .filter(([, amount]) => amount > 0)
    .map(([mana, amount]) => `{${mana}}×${amount}`);
  return parts.length > 0 ? parts.join(" ") : "empty";
}

export function describeModification(m: Modification): string {
  switch (m.kind) {
    case "modifyPT":
      return `${signed(m.power)}/${signed(m.toughness)}`;
    case "setPT":
      return `base ${m.power}/${m.toughness}`;
    case "setTypes":
      return `becomes ${m.types.join(" and ")}`;
    case "addTypes":
      return `also becomes ${m.types.join(" and ")}`;
    case "addSubtypes":
      return `gains ${m.types.length === 1 ? "subtype" : "subtypes"} ${m.types.join(" and ")}`;
    case "setColors":
      return `becomes ${m.colors.length > 0 ? m.colors.join("") : "colorless"}`;
    case "addColors":
      return `gains ${m.colors.join("")} color${m.colors.length === 1 ? "" : "s"}`;
    case "addKeywords":
      return `gains ${m.keywords.join(" and ")}`;
    case "addAbilities":
      return `gains "${m.abilities.map((a) => abilityText(a, "<this>")).join('" and "')}"`;
    case "removeKeywords":
      return `loses ${m.keywords.join(" and ")}`;
    case "switchPT":
      return "switches power and toughness";
    default:
      return unreachable(m);
  }
}

function describeModifications(modifications: readonly Modification[]): string {
  return modifications.map(describeModification).join(", ");
}

export function describeAllEffects(ability: Ability): string {
    if (ability.kind === "keyword") return ability.keyword;
    if (ability.kind === "static") return describeStaticEffect(ability.effect);
    return ability.effects.map((e) => {
        const cost = ability.kind === "activated" ? describeCost( ability.cost) : "";
        const effect = describeEffect(e);
        return cost === "" ? effect : `${cost} → ${effect}`;
    }).join(". ");
}

function describeStaticEffect(effect: StaticEffect): string {
    const who = effect.affects.kind === "self" ? "this object" : describeObjectPredicate(effect.affects.filter);
    return `${who}: ${describeModifications(effect.modifications)}`;
}

function describeAppliedEffect(effect: AppliedEffect): string {
  const who = effect.affects.kind === "matching"
    ? describeObjectPredicate(effect.affects.filter)
    : describeEffectTarget(effect.affects);
  return `${who}: ${describeModifications(effect.modifications)} (${effect.duration})`;
}

export function describeDuration(duration: Duration): string {
    switch (duration) {
        case "untilEndOfTurn":
            return "until end of turn";
        case "whileSourceOnBattlefield":
            return "while its source remains on the battlefield";
        case "permanent":
            return "permanently";
        default:
            return unreachable(duration);
    }
}

export function describeContinuousEffect(state: GameState, e: ContinuousEffect): string {
  const who = e.affects.kind === "objects"
    ? e.affects.ids.map((id) => nameOf(state, id)).join(", ")
    : describeObjectPredicate(e.affects.filter);
  return `${describeModifications(e.modifications)} on ${who} — from ${e.sourceName} (timestamp ${e.timestamp}, ${describeDuration(e.duration)})`;
}

function describeEffectTarget(t: EffectTarget): string {
    switch (t.kind) {
        case "target":
            return `target ${t.spec + 1}`;
        case "allTargets":
            return "all targets";
        case "self":
            return "this object";
        case "player":
            switch (t.who) {
                case "controller":
                    return "you";
                case "owner":
                    return "this object's owner";
                case "eachOpponent":
                    return "each opponent";
                case "eachPlayer":
                    return "each player";
                default:
                    return unreachable(t.who);
            }
        case "bound":
            return `$${t.name}`;
        default:
            return unreachable(t);
    }
}

export function describeEffect(e: Effect): string {
    switch (e.kind) {
        case "draw":
            return `${describeEffectTarget(e.who)} ${effectVerb(e.who, "draws", "draw")} ${describeAmount(e.count)}`;
        case "damage":
            return `deal ${describeAmount(e.amount)} damage to ${describeEffectTarget(e.to)}`;
        case "gainLife":
            return `${describeEffectTarget(e.who)} ${effectVerb(e.who, "gains", "gain")} ${describeAmount(e.amount)} life`;
        case "loseLife":
            return `${describeEffectTarget(e.who)} ${effectVerb(e.who, "loses", "lose")} ${describeAmount(e.amount)} life`;
        case "destroy":
            return `destroy ${describeEffectTarget(e.target)}`;
        case "addMana": {
            const mana = e.mana.kind === "mana" ? `{${e.mana.type}}` : `$${e.mana.name}`;
            return `add ${describeAmount(e.amount)}× ${mana}`;
        }
        case "applyContinuousEffect":
            return `apply effect: ${describeAppliedEffect(e.template)}`;
        case "choose":
            return describeEffectChoice(e);
        case "discard":
            return `$${e.cards.name} are discarded from their owner's hand`;
        case "askYesNo":
            return `${e.prompt}`;
        case "if": {
            const condition = describeCondition(e.condition);
            const thenEffects = describeEffects(e.then);
            const otherwise = e.else ? `; otherwise, ${describeEffects(e.else)}` : "";
            return `If ${condition}, ${thenEffects}${otherwise}`;
        }
        case "forEach": {
            const [subject, reference] = describeLoopSubject(e.over);
            return `For ${subject}, ${describeEffects(e.body)}`;
        }
        case "setBinding":
            return "";
        default:
            return unreachable(e);
    }
}

function effectVerb(target: EffectTarget, singular: string, plural: string): string {
    if (target.kind === "allTargets" || (target.kind === "player" && target.who === "controller")) return plural;
    return singular;
}

function describeEffects(effects: readonly Effect[]): string {
    const descriptions = effects.map(describeEffect).filter(Boolean);
    return descriptions.length > 0 ? descriptions.join("; ") : "do nothing";
}

function describeLoopSubject(target: EffectTarget): [string, string] {
    if (target.kind === "player") {
        switch (target.who) {
            case "eachPlayer":
                return ["each player", "that player"];
            case "eachOpponent":
                return ["each opponent", "that opponent"];
            case "controller":
                return ["you", "you"];
            case "owner":
                return ["the owner", "that owner"];
            default:
                return unreachable(target.who);
        }
    }
    if (target.kind === "allTargets") return ["each target", "that target"];
    if (target.kind === "target") return [`target ${target.spec + 1}`, `target ${target.spec + 1}`];
    if (target.kind === "self") return ["this object", "this object"];
    const label = `$${target.name}`;
    return [label, label];
}

function describeCondition(condition: Condition): string {
    switch (condition.kind) {
        case "flag":
            return `$${condition.name}`;

        case "compare":
            return `${describeAmount(condition.left)} ${condition.op} ${describeAmount(condition.right)}`;
        case "not":
            return `not (${describeCondition(condition.of)})`;
        case "all":
            return condition.of.map((part) => describeCondition(part)).join(" and ");
        case "any":
            return condition.of.map((part) => describeCondition(part)).join(" or ");
        default:
            return unreachable(condition);
    }
}

function describeObjectPredicate(predicate: ObjectPredicate): string {
    if (predicate.kind === "isSource") return "this object";
    return `an object that ${describeObjectCondition(predicate)}`;
}

function describeObjectCondition(predicate: ObjectPredicate): string {
    if (predicate.kind === "not") return `does not match ${describeObjectPredicate(predicate.of)}`;
    if (predicate.kind === "all" || predicate.kind === "any") {
        const parts = predicate.of.map(describeObjectCondition);
        const conjunction = predicate.kind === "all" ? "and" : "or";
        return parts.join(` ${conjunction} `);
    }
    switch (predicate.kind) {
        case "hasType":
            return `is ${indefiniteArticle(predicate.type)} ${predicate.type.toLowerCase()}`;
        case "hasColor":
            return `is ${describeColor(predicate.color)}`;
        case "hasSupertype":
            return `is ${predicate.type.toLowerCase()}`;
        case "hasSubtype":
            return `has subtype ${predicate.type}`;
        case "hasKeyword":
            return `has ${predicate.keyword}`;
        case "controlledBy":
            return predicate.who === "you" ? "is controlled by you" : "is controlled by an opponent";
        case "inZone":
            return `is in ${predicate.zone}`;
        case "isSource":
            return "is this object";
        default:
            return unreachable(predicate);
    }
}

function describePlayerPredicate(predicate: PlayerPredicate): string {
    if (predicate.kind === "not") return `someone other than ${describePlayerPredicate(predicate.of)}`;
    if (predicate.kind === "all" || predicate.kind === "any") {
        const parts = predicate.of.map(describePlayerPredicate);
        return parts.join(predicate.kind === "all" ? " and " : " or ");
    }

    switch (predicate.kind) {
        case "anyPlayer":
            return "a player";
        case "you":
            return "you";
        case "opponent":
            return "an opponent";
        default:
            return unreachable(predicate);
    }
}

function describeEventLeaf(predicate: EventLeaf): string {
    switch (predicate.kind) {
        case "cardMoved": {
            const object = predicate.object ? describeObjectPredicate(predicate.object) : "a card";
            const from = predicate.from ? ` from ${predicate.from}` : "";
            const to = predicate.to ? ` to ${predicate.to}` : "";
            return `${object} moves${from}${to}`;
        }
        case "damageDealt": {
            const target = predicate.target
                ? isPlayerPredicate(predicate.target)
                    ? `${describePlayerPredicate(predicate.target)} ${predicate.target.kind === "you" ? "are" : "is"} dealt`
                    : `${describeObjectPredicate(predicate.target)} is dealt`
                : "something is dealt";
            const source = predicate.source ? ` by ${describeObjectPredicate(predicate.source)}` : "";
            const amount = predicate.amount ? ` ${describeNumberTest(predicate.amount)} damage` : " damage";
            const combat = predicate.isCombatDamage === undefined ? "" : predicate.isCombatDamage ? " as combat damage" : " as noncombat damage";
            return `${target}${amount}${source}${combat}`;
        }
        case "stepStarted": {
            const step = describeStep(predicate.step);
            const player = predicate.player ? describePlayerPossessive(predicate.player) : "the";
            return `${player} ${step} step begins`;
        }
        case "spellCast": {
            const spell = predicate.spell ? describeObjectPredicate(predicate.spell) : "a spell";
            return `${describePlayerAction(predicate.by, "cast", "casts")} ${spell}`;
        }
        case "abilityActivated": {
            const source = predicate.source ? ` of ${describeObjectPredicate(predicate.source)}` : "";
            return `${describePlayerAction(predicate.by, "activate", "activates")} an ability${source}`;
        }
        case "lifeChanged": {
            const player = predicate.player ? describePlayerPossessive(predicate.player) : "a player's";
            const delta = predicate.delta ? ` by a value ${describeDeltaTest(predicate.delta)}` : "";
            return `${player} life total changes${delta}`;
        }
        case "attackDeclared": {
            const attacker = predicate.attacker ? ` with ${describeObjectPredicate(predicate.attacker)}` : "";
            return `${describePlayerAction(predicate.player, "attack", "attacks")}${attacker}`;
        }
        case "blockDeclared": {
            const blocker = predicate.blocker ? ` with ${describeObjectPredicate(predicate.blocker)}` : "";
            const attacker = predicate.attacker ? `, blocking ${describeObjectPredicate(predicate.attacker)}` : "";
            return `${describePlayerAction(predicate.player, "block", "blocks")}${blocker}${attacker}`;
        }
        case "cardDrawn":
            return `${describePlayerAction(predicate.player, "draw", "draws")} a card`;
        default:
            return unreachable(predicate);
    }
}

function isPlayerPredicate(predicate: ObjectPredicate | PlayerPredicate): predicate is PlayerPredicate {
    if (predicate.kind === "not") return isPlayerPredicate(predicate.of);
    if (predicate.kind === "all" || predicate.kind === "any") {
        const first = predicate.of[0];
        return first ? isPlayerPredicate(first) : false;
    }
    return predicate.kind === "anyPlayer" || predicate.kind === "you" || predicate.kind === "opponent";
}

function describePlayerPossessive(predicate: PlayerPredicate): string {
    if (predicate.kind === "not") return `${describePlayerPredicate(predicate.of)}'s`;
    if (predicate.kind === "all" || predicate.kind === "any") {
        return `${predicate.of.map(describePlayerPossessive).join(predicate.kind === "all" ? " and " : " or ")}`;
    }
    switch (predicate.kind) {
        case "anyPlayer":
            return "a player's";
        case "you":
            return "your";
        case "opponent":
            return "an opponent's";
        default:
            return unreachable(predicate);
    }
}

function describePlayerAction(predicate: PlayerPredicate | undefined, verb: string, thirdPersonVerb: string): string {
    if (!predicate) return `a player ${thirdPersonVerb}`;
    if (predicate.kind === "you") return `you ${verb}`;
    if (predicate.kind === "opponent") return `an opponent ${thirdPersonVerb}`;
    if (predicate.kind === "anyPlayer") return `a player ${thirdPersonVerb}`;
    return `a qualifying player ${thirdPersonVerb}`;
}

function describeNumberTest(test: { op: Comparison; value: number }): string {
    const operators: Readonly<Record<Comparison, string>> = {
        ">": "more than",
        ">=": "at least",
        "==": "exactly",
        "!=": "other than",
        "<": "less than",
        "<=": "at most",
    };
    return `${operators[test.op]} ${test.value}`;
}

function describeDeltaTest(test: { op: Comparison; value: number }): string {
    const operators: Readonly<Record<Comparison, string>> = {
        ">": "more than",
        ">=": "at least",
        "==": "exactly",
        "!=": "other than",
        "<": "less than",
        "<=": "at most",
    };
    return `${operators[test.op]} ${signed(test.value)}`;
}

function indefiniteArticle(noun: string): "a" | "an" {
    return /^[aeiou]/i.test(noun) ? "an" : "a";
}

function describeColor(color: "W" | "U" | "B" | "R" | "G"): string {
    switch (color) {
        case "W":
            return "white";
        case "U":
            return "blue";
        case "B":
            return "black";
        case "R":
            return "red";
        case "G":
            return "green";
        default:
            return unreachable(color);
    }
}

function describeStep(step: GameState["turn"]["step"]): string {
    return step.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}

/** Describes the event condition that causes a triggered ability to trigger. */
export function describeEventPredicate(predicate: EventPredicate): string {
    if (predicate.kind === "not") {
        return `Whenever an event does not match: ${stripEventTiming(describeEventPredicate(predicate.of))}`;
    }
    if (predicate.kind === "all" || predicate.kind === "any") {
        const parts = predicate.of.map((part) => stripEventTiming(describeEventPredicate(part)));
        const conjunction = predicate.kind === "all" ? "and" : "or";
        return `Whenever an event matches ${predicate.kind === "all" ? "all" : "any"} of: ${parts.join(` ${conjunction} `)}`;
    }

    if (predicate.kind === "stepStarted") {
        const player = predicate.player ? describePlayerPossessive(predicate.player) : "the";
        const step = describeStep(predicate.step);
        const stepSuffix = predicate.step === "upkeep" && predicate.player ? "" : " step";
        return `At the beginning of ${player} ${step}${stepSuffix}`;
    }
    const description = describeEventLeaf(predicate);
    return `Whenever ${description}`;
}

function stripEventTiming(description: string): string {
    return description.replace(/^(?:Whenever |At the beginning of )/, "");
}

export function describeAmount(a: Amount): string {
    return typeof a === "number" ? String(a) : `$${a.name}`;
}

export function describeEffectChoice(e: Extract<Effect, { kind: "choose" }>): string {
    return `Choice: ${e.prompt}`; // Too complicated to piece apart full choice settings on client
}

export function describeCost(c: Cost): string {
  const parts: string[] = [];
  if (c.mana !== undefined) parts.push(describeManaCost(c.mana));
  if (c.tap) parts.push("{T}");
  if (c.sacrificeSelf) parts.push("sacrifice this");
  return parts.length > 0 ? parts.join(", ") : "no cost";
}

const describeTargetSpecs = (specs?: TargetSpec[]): string => {
  if (!specs || specs.length === 0) { return "";}
  return ` targeting ${specs.map((s) => { 
    const count = s.minCount === s.maxCount ? s.maxCount : `${s.minCount} - ${s.maxCount}`
    const isPlural = s.minCount !== 1 || s.maxCount !== 1;
    const filterDescription = s.targetName ? (isPlural && !s.targetName.endsWith("s") ? `${s.targetName}s` : s.targetName) : describeTargetFilter(s.filter, isPlural);
    return `${count} ${filterDescription}`;
  }).join(", ")}`;
}

function describeTargetFilter(filter: TargetFilter, plural: boolean): string {
    switch (filter.kind) {
        case "player":
            return plural ? "players" : "player";
        case "object":
            return plural ? "objects" : "object";
        case "stackEntry":
            return plural ? "stack entries" : "stack entry";
        case "anyOf":
            return filter.of.map((part) => describeTargetFilter(part, plural)).join(" or ");
        default:
            return unreachable(filter);
    }
}

// ---------------------------------------------------------------------------
// Targets, decisions, actions, events
// ---------------------------------------------------------------------------

export function describeTarget(state: GameState, t: Target): string {
  return t.kind === "object" ? `${nameOf(state, t.id)} (#${t.id})` : `player ${t.id}`;
}

function describeAbilityReference(state: GameState, id: ObjectId, ref: AbilityRef): string {
    const ability = getAbilityByRef(state, id, ref);
    const key = refKey(id, ref);
    if (!ability) return `Ability of ${nameOf(state, id)} (${key})`;
    return `${abilityText(ability, nameOf(state, id))} (${key})`;
}

export function describeChoiceValue(state: GameState, v: ChoiceValue): string {
  switch (v.kind) {
      case "object":
          return `${nameOf(state, v.id)} (#${v.id})`;
      case "player":
          return `player ${v.id}`;
      case "index":
          return `option ${v.index}`;
      case "ability":
          return `${describeAbilityReference(state, v.id, v.ref)}`;
      case "trigger":
          return `triggered ability #${v.id}`;
      case "stackEntry":
          return nameOfStackEntry(state, v.id, true);
      case "mana":
          return `Add ${describeManaType(v.mana)} mana`;
      case "null":
          return "";
      default:
          return unreachable(v);
  }
}

const describeManaType = (mana: ManaType): string => {
    switch (mana) {
        case "W":
            return "white";
        case "U":
            return "blue";
        case "B":
            return "black";
        case "R":
            return "red";
        case "G":
            return "green";
        case "C":
            return "colorless";
        default:
            return unreachable(mana);
    }
};

export function describeAction(state: GameState, a: Action): string {
  switch (a.type) {
      case "passPriority":
          return "";
      case "playLand": {
          const chars = getCharacteristics(state, a.card);
          if (!chars) return "";
          return chars.abilities.map((a) => abilityText(a, chars.name)).join("\n");
      }
      case "castSpell": {
          const chars = getCharacteristics(state, a.card);
          if (!chars) return "";
          const cost = describeManaCost(chars.manaCost);
          const spell = getAbilityForSpell(chars);
          const text = spell && spell.text !== "" ? spell.text : "";
          return cost === "" ? text : cost + (text === "" ? "" : `: ${text}`);
      }
      case "activateAbility":
          return describeAbilityReference(state, a.source, a.abilityRef);
      default:
          return unreachable(a);
  }
}

/** What the player picked, in words, for the log. */
export function describeAnswer(d: Decision, a: Answer): string {
  switch (a.kind) {
    case "priority":
      return d.kind === "priority" ? (d.options.find((o) => o.id === a.option)?.label ?? a.option) : a.option;
    case "yesNo":
      return a.value ? "Yes" : "No";
    case "choose": {
      const labels =
        d.kind === "choose" ? a.selected.map((id) => d.options.find((o) => o.id === id)?.label ?? id) : [...a.selected];
      return labels.length > 0 ? labels.join(", ") : "(nothing)";
    }
    case "order": {
      const labels =
        d.kind === "order"
          ? a.order.map((index) => d.options[index]?.label ?? String(index))
          : a.order.map(String);
      return labels.length > 0 ? labels.join(" → ") : "(nothing)";
    }
    case "cancel":
      return "(canceled)";
    default:
      return unreachable(a);
  }
}

/** Describes an event using the state AFTER it happened, so moved cards can be looked up by their new ids. */
export function describeEvent(state: GameState, e: GameEvent): string {
  switch (e.type) {
      // Steps
      case "turnStarted":
          return `Turn ${e.turn} begins (${e.activePlayer})`;
      case "stepStarted":
          return `Step: ${e.step}`;
      case "priorityPassed":
          return `${e.player} passes priority (${e.step})`;
      case "cardMoved":
          return `${nameOf(state, e.newId)}: ${e.from} → ${e.to} (#${e.oldId} → #${e.newId})`;

      // Player effects
      case "cardDrawn":
          return `${e.player} draws ${e.cardName}`;
      case "landPlayed":
          return `${e.player} plays ${e.cardName}`;
      case "lifeChanged":
          return `${e.player} life ${signed(e.delta)}`;
      case "manaAdded":
          return `${e.player} adds ${e.amount}x ${e.mana}`;

      // Object effects
      case "damageDealt":
          return `${e.sourceLki.chars.name} deals ${e.amount} damage to ${e.targetLki ? `${e.targetLki.chars.name} (#${e.target.id})` : e.targetName}`;
      case "permanentTapped":
          return `${e.cardName} is tapped`;
      case "permanentUntapped":
          return `${e.cardName} is untapped`;
      case "permanentDestroyed":
          return `${e.cardName} (#${e.object}) is destroyed${e.sourceName ? ` by ${e.sourceName}` : ""}`;
      case "permanentSacrificed":
          return `${e.cardName} (#${e.object}) is sacrificed${e.sourceName ? ` by ${e.sourceName}` : ""}`;
      case "cardDiscarded":
          return e.cause ? `${e.cause} causes ${e.player} to discard ${e.cardName} (#${e.card})` : `${e.player} discards ${e.cardName} (#${e.card})`;
      case "continuousEffectCreated":
          return `Continuous effect created: ${describeContinuousEffect(state, e.effect)}`;
      case "continuousEffectExpired":
          return `Continuous effect expired: ${describeContinuousEffect(state, e.effect)}`;

      // Spells & Abilities
      case "spellCast":
          return `${e.player} casts ${e.spellLki.chars.name}`;
      case "spellCastStart":
          return `${e.player} starts casting ${e.cardName}`;
      case "spellTargetsSelected":
          return `${e.player} selects targets for ${e.cardName}`; // Include target details later
      case "spellManaPaid":
          return `${e.player} pays mana for ${e.cardName}`;
      case "spellCastCancelled":
          return `${e.player} cancels casting of ${e.cardName}`;
      case "abilityActivateStart":
          return `${e.player} starts activating ${e.sourceName}'s ability (${e.description})`;
      case "abilityActivated":
          return (
              `${e.player} activates ${e.abilitySourceLki.chars.name}'s ability (#${e.abilitySourceLki.id}): ${e.description}` +
              (e.targets.length > 0 ? ` targeting ${e.targets.map((t) => describeTarget(state, t)).join(", ")}` : "")
          );
      case "abilityActivateCancelled":
          return `${e.player} cancels activation of ${e.sourceName}'s ability (${e.description})`;
      case "abilityTriggered":
          return (
              `${e.player}'s ${e.abilitySourceLki.chars.name}'s ability triggers (${e.description})` +
              (e.targets.length > 0 ? ` targeting ${e.targets.map((t) => describeTarget(state, t)).join(", ")}` : "")
          );
      case "stackEntryResolved":
          return `${e.entryName} (stack entry #${e.id}) resolves`;
      case "stackEntryFizzles":
          return `${e.entryName} (stack entry #${e.id}) fizzles due to lack of targets`;

      // Attacks
      case "attackDeclared":
          return `${e.player} attacks ${e.targetLki ? `${e.targetLki.chars.name} (#${e.targetLki.id})` : e.targetName} with ${e.attackerLki.chars.name} (#${e.attackerLki.id})`;
      case "attacksCancelled":
          return `${e.player} cancels their attacks`;
      case "blockDeclared":
          return `${e.player} blocks ${e.attackerLki.chars.name} (#${e.attackerLki.id}) with ${e.blockerLki.chars.name} (#${e.blockerLki.id})`;
      case "blocksCancelled":
          return `${e.player} cancels their blocks`;

      // Game win/lose
      case "lostTheGame":
          return `${e.player} loses the game due to ${e.cause}!`;
      case "wonTheGame":
          return `${e.player} wins the game!`;
      default:
          return unreachable(e);
  }
}

// ---------------------------------------------------------------------------
// Consistency checks
// ---------------------------------------------------------------------------

/**
 * Cross-checks the zone lists against each object's own `zone` field. Any message returned means
 * the engine put the state into a shape it shouldn't be able to reach.
 */
export function findProblems(state: GameState): string[] {
  const problems: string[] = [];
  const listedIn = new Map<ObjectId, { zone: Zone; where: string }[]>();

  const check = (ids: readonly ObjectId[], zone: Zone, where: string): void => {
    for (const id of ids) {
      const obj = state.objects[id];
      if (!obj) {
        problems.push(`${where} lists #${id}, which is not in state.objects`);
        continue;
      }
      if (obj.zone !== zone) {
        problems.push(`#${id} (${nameOf(state, id)}) is in ${where} but its zone says "${obj.zone}"`);
      }
      listedIn.set(id, [...(listedIn.get(id) ?? []), { zone, where }]);
    }
  };

  for (const p of Object.values(state.players)) {
    check(p.library, "library", `${p.id}'s library`);
    check(p.hand, "hand", `${p.id}'s hand`);
    check(p.graveyard, "graveyard", `${p.id}'s graveyard`);
  }
  check(state.battlefield, "battlefield", "the battlefield");
  check(state.exile, "exile", "exile");

  for (const [id, lists] of listedIn) {
    if (lists.length > 1) {
      problems.push(`#${id} is listed in more than one zone: ${lists.map((l) => l.where).join(", ")}`);
    }
  }

  const spellSources = new Set(state.stack.filter((e) => e.kind === "spell").map((e) => e.source));
  const r = state.resolving;
  if (r?.entry.kind === "spell") spellSources.add(r.entry.source);
  for (const obj of Object.values(state.objects)) {
    if (obj.zone === "stack") {
      if (!spellSources.has(obj.id)) {
        problems.push(`#${obj.id} (${nameOf(state, obj.id)}) says it is on the stack but no stack entry is for it`);
      }
    } else if (!listedIn.get(obj.id)?.some((l) => l.zone === obj.zone)) {
      problems.push(`#${obj.id} (${nameOf(state, obj.id)}) says it is in ${obj.zone} but no ${obj.zone} lists it`);
    }
  }
  for (const entry of state.stack) {
    if (entry.kind === "spell" && state.objects[entry.source]?.zone !== "stack") {
      problems.push(`Stack entry #${entry.id} is a spell whose card (#${entry.source}) is not in the stack zone`);
    }
  }
  
  if (r?.entry.kind === "spell" && state.objects[r.entry.source]?.zone !== "stack") {
      problems.push(`Resolving spell's card (#${r.entry.source}) is not in the stack zone`);
  }
  return problems;
}
