import {
  getCharacteristics,
  type Ability,
  type Action,
  type Answer,
  type ChoiceValue,
  type ContinuousEffect,
  type ContinuousEffectTemplate,
  type Cost,
  type Decision,
  type Effect,
  type EffectTarget,
  type GameEvent,
  type GameState,
  type ManaCost,
  type ManaPool,
  type Modification,
  type ObjectId,
  type Target,
  type TargetSpec,
  type Zone,
} from "@mtg/engine";

function unreachable(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/** A card's name, or "#id" when the object no longer exists (e.g. it changed zones since an event). */
export const nameOf = (state: GameState, id: ObjectId): string =>
  getCharacteristics(state, id)?.name ?? `#${id}`;

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
    case "addKeyword":
      return `gains ${m.keyword}`;
    case "addType":
      return `becomes ${m.type}`;
    case "setColors":
      return `becomes ${m.colors.length > 0 ? m.colors.join("") : "colorless"}`;
    default:
      return unreachable(m);
  }
}

function describeTemplate(t: ContinuousEffectTemplate): string {
  const who = t.affects.kind === "self" ? "this" : "all creatures";
  return `${who}: ${describeModification(t.modification)} (${t.duration})`;
}

export function describeContinuousEffect(state: GameState, e: ContinuousEffect): string {
  const who = e.affects.kind === "object" ? nameOf(state, e.affects.id) : "all creatures";
  return `${describeModification(e.modification)} on ${who} — from ${nameOf(state, e.source)} (timestamp ${e.timestamp}, ${e.duration})`;
}

function describeEffectTarget(t: EffectTarget): string {
  switch (t.kind) {
    case "target":
      return `target ${t.index + 1}`;
    case "self":
      return "this object";
    case "player":
      return t.who;
    default:
      return unreachable(t);
  }
}

export function describeEffect(e: Effect): string {
  switch (e.kind) {
    case "draw":
      return `${e.who} draws ${e.count}`;
    case "damage":
      return `deal ${e.amount} damage to ${describeEffectTarget(e.to)}`;
    case "gainLife":
      return `${e.who} gains ${e.amount} life`;
    case "loseLife":
      return `${e.who} loses ${e.amount} life`;
    case "destroy":
      return `destroy ${describeEffectTarget(e.target)}`;
    case "addMana":
      return `add ${e.amount}× {${e.mana}}`;
    case "applyContinuousEffect":
      return `apply ${describeTemplate(e.template)}`;
    default:
      return unreachable(e);
  }
}

export function describeCost(c: Cost): string {
  const parts: string[] = [];
  if (c.mana !== null) parts.push(describeManaCost(c.mana));
  if (c.tap) parts.push("{T}");
  if (c.sacrificeSelf) parts.push("sacrifice this");
  return parts.length > 0 ? parts.join(", ") : "no cost";
}

const describeTargetSpecs = (specs: readonly TargetSpec[]): string =>
  specs.length > 0 ? ` targeting ${specs.map((s) => s.kind).join(", ")}` : "";

const describeEffects = (effects: readonly Effect[]): string => effects.map(describeEffect).join("; ");

export function describeAbility(a: Ability): string {
  switch (a.kind) {
    case "keyword":
      return `Keyword: ${a.keyword}`;
    case "spell":
      return `Spell${describeTargetSpecs(a.targets)}: ${describeEffects(a.effects)}`;
    case "activated":
      return `${a.isManaAbility ? "Mana ability" : "Activated"}${describeTargetSpecs(a.targets)}: ${describeCost(a.cost)} → ${describeEffects(a.effects)}`;
    case "triggered":
      return `Triggered${describeTargetSpecs(a.targets)}: when ${a.trigger.event} (${a.trigger.scope}) → ${describeEffects(a.effects)}`;
    case "static":
      return `Static: ${describeTemplate(a.effect)}`;
    default:
      return unreachable(a);
  }
}

// ---------------------------------------------------------------------------
// Targets, decisions, actions, events
// ---------------------------------------------------------------------------

export function describeTarget(state: GameState, t: Target): string {
  return t.kind === "object" ? `${nameOf(state, t.id)} (#${t.id})` : `player ${t.id}`;
}

export function describeChoiceValue(state: GameState, v: ChoiceValue): string {
  switch (v.kind) {
    case "object":
      return `${nameOf(state, v.id)} (#${v.id})`;
    case "player":
      return `player ${v.id}`;
    case "index":
      return `option ${v.index}`;
    default:
      return unreachable(v);
  }
}

export function describeAction(state: GameState, a: Action): string {
  switch (a.type) {
    case "passPriority":
      return "pass priority";
    case "playLand":
      return `play land ${nameOf(state, a.card)} (#${a.card})`;
    case "castSpell":
      return `cast ${nameOf(state, a.card)} (#${a.card})`;
    case "activateAbility":
      return `activate ability ${a.abilityIndex} of ${nameOf(state, a.source)} (#${a.source})`;
    case "declareAttackers":
      return `declare ${a.attackers.length} attacker(s)`;
    case "declareBlockers":
      return `declare ${a.blocks.length} blocker(s)`;
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
    default:
      return unreachable(a);
  }
}

/** Describes an event using the state AFTER it happened, so moved cards can be looked up by their new ids. */
export function describeEvent(state: GameState, e: GameEvent): string {
  switch (e.type) {
    case "turnStarted":
      return `Turn ${e.turn} begins (${e.activePlayer})`;
    case "stepStarted":
      return `Step: ${e.step}`;
    case "priorityPassed":
      return `${e.player} passes priority`;
    case "cardMoved":
      return `${nameOf(state, e.newId)}: ${e.from} → ${e.to} (#${e.oldId} → #${e.newId})`;
    case "cardDrawn":
      return `${e.player} draws ${nameOf(state, e.card)}`;
    case "landPlayed":
      return `${e.player} plays ${nameOf(state, e.card)}`;
    case "spellCast":
      return `${e.player} casts ${nameOf(state, e.card)}`;
    case "stackEntryResolved":
      return `Stack entry #${e.id} resolves`;
    case "damageDealt":
      return `${nameOf(state, e.source)} deals ${e.amount} damage to ${describeTarget(state, e.target)}`;
    case "lifeChanged":
      return `${e.player} life ${signed(e.delta)}`;
    case "gameWon":
      return `${e.winner} wins`;
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
  return problems;
}
