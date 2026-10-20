import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  cardDefId,
  chooseMany,
  indexChoice,
  moveObject,
  yesNo,
  type DecisionId,
  type GameState,
  type StackId,
} from "@mtg/engine";
import { App } from "./App";
import { DecisionPanel } from "./components/DecisionPanel";
import { StackPanel } from "./components/StackPanel";
import { ALICE, BOB, newDemoGame } from "./demo";

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

const playerRegion = (player: string) => screen.getByRole("region", { name: `Player ${player}` });

/** The <details> element for a zone, found by its title inside one player's panel. */
function zoneOf(region: HTMLElement, title: string): HTMLDetailsElement {
  const label = within(region).getByText(title, { selector: "summary > span" });
  return must(label.closest("details"));
}

const cardsIn = (zone: HTMLElement) => [...zone.querySelectorAll<HTMLDetailsElement>("details.obj")];

describe("zones", () => {
  test("each player gets their own containers, with one collapsible element per card", () => {
    render(<App />);
    for (const player of [ALICE, BOB]) {
      const region = playerRegion(player);
      expect(cardsIn(zoneOf(region, "Hand"))).toHaveLength(7);
      expect(cardsIn(zoneOf(region, "Library"))).toHaveLength(14);
      expect(cardsIn(zoneOf(region, "Battlefield"))).toHaveLength(0);
      expect(cardsIn(zoneOf(region, "Graveyard"))).toHaveLength(0);
    }
  });

  test("an element lists its properties as bullets", () => {
    render(<App />);
    const card = must(cardsIn(zoneOf(playerRegion(ALICE), "Hand"))[0]);
    const bullets = [...card.querySelectorAll(".bullets > li")].map((li) => li.textContent);
    expect(bullets).toContain("Owneralice");
    expect(bullets).toContain("Controlleralice");
    expect(bullets).toContain("Zonehand");
    expect(bullets).toContain("Tappedno");
    expect(bullets.some((b) => b?.startsWith("Abilities"))).toBe(true);
  });

  test("expand all and collapse all affect every card in that zone only", () => {
    render(<App />);
    const region = playerRegion(ALICE);
    const hand = zoneOf(region, "Hand");
    const library = zoneOf(region, "Library");
    const handCards = cardsIn(hand);
    const libraryCards = cardsIn(library);
    expect(handCards.some((c) => c.open)).toBe(false);

    fireEvent.click(within(hand).getByRole("button", { name: "expand all" }));
    expect(handCards.every((c) => c.open)).toBe(true);
    expect(libraryCards.some((c) => c.open)).toBe(false);
    expect(hand.open).toBe(true); // clicking the button must not also collapse the zone

    fireEvent.click(within(hand).getByRole("button", { name: "collapse all" }));
    expect(handCards.some((c) => c.open)).toBe(false);
  });

  test("the library starts collapsed and marks its top card", () => {
    render(<App />);
    const library = zoneOf(playerRegion(BOB), "Library");
    expect(library.open).toBe(false);
    expect(must(cardsIn(library)[0]).textContent).toContain("top");
  });
});

describe("decision panel", () => {
  test("a priority decision is answered by selecting an option and submitting", () => {
    render(<App />);
    const panel = screen.getByRole("region", { name: "Decision" });
    expect(within(panel).getByText("alice must answer")).toBeTruthy();

    const submit = within(panel).getByRole<HTMLButtonElement>("button", { name: "Submit answer" });
    expect(submit.disabled).toBe(true);

    fireEvent.click(within(panel).getByLabelText(/Pass priority/));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    expect(within(panel).getByText("bob must answer")).toBeTruthy();
    expect(within(panel).getByRole<HTMLButtonElement>("button", { name: "Submit answer" }).disabled).toBe(true);
    expect(within(screen.getByRole("region", { name: "Log" })).getByText("alice: Pass priority")).toBeTruthy();
  });

  test("auto-pass stops at the first real choice, and a land can be played from it", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Auto-pass" }));

    const steps = screen.getByRole("list", { name: "Turn steps" });
    expect(steps.querySelector("li.on")?.textContent).toBe("precombatMain");

    const panel = screen.getByRole("region", { name: "Decision" });
    expect(within(panel).getByText("alice must answer")).toBeTruthy();
    fireEvent.click(must(within(panel).getAllByLabelText(/^Play /)[0]));
    fireEvent.click(within(panel).getByRole("button", { name: "Submit answer" }));

    const region = playerRegion(ALICE);
    expect(cardsIn(zoneOf(region, "Battlefield"))).toHaveLength(1);
    expect(cardsIn(zoneOf(region, "Hand"))).toHaveLength(6);
    expect(screen.getByText("state consistent")).toBeTruthy();
    // The land drop is used up, so alice still has priority but only "pass" is left.
    expect(within(panel).queryAllByLabelText(/^Play /)).toHaveLength(0);
  });

  test("a choose decision only enables Submit for a valid number of picks", () => {
    const options = [indexChoice(0, "Red"), indexChoice(1, "Blue"), indexChoice(2, "Green")];
    const pending = chooseMany({
      id: 900 as DecisionId,
      player: ALICE,
      prompt: "Pick two",
      options,
      min: 2,
      max: 2,
      then: { kind: "discardToHandSize" },
    });
    const onSubmit = vi.fn();
    render(<DecisionPanel state={{ ...newDemoGame(), pending }} error={null} onSubmit={onSubmit} />);

    const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Submit answer" });
    expect(submit.disabled).toBe(true);
    expect(screen.getByText("Choose exactly 2")).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Red/));
    fireEvent.click(screen.getByLabelText(/Blue/));
    expect(submit.disabled).toBe(false);

    fireEvent.click(screen.getByLabelText(/Green/));
    expect(submit.disabled).toBe(true); // three picks is too many

    fireEvent.click(screen.getByLabelText(/Green/));
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ kind: "choose", selected: ["index:0", "index:1"] });
  });

  test("a cancelable decision submits a cancel answer", () => {
    const pending = yesNo({
      id: 901 as DecisionId,
      player: BOB,
      prompt: "Keep this hand?",
      then: { kind: "discardToHandSize" },
      onCancel: { kind: "cancel" },
    });
    const onSubmit = vi.fn();
    render(<DecisionPanel state={{ ...newDemoGame(), pending }} error={null} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByLabelText("Cancel"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    expect(onSubmit).toHaveBeenCalledWith({ kind: "cancel" });
  });

  test("a yes/no decision submits a boolean", () => {
    const pending = yesNo({
      id: 902 as DecisionId,
      player: BOB,
      prompt: "Keep this hand?",
      then: { kind: "discardToHandSize" },
    });
    const onSubmit = vi.fn();
    render(<DecisionPanel state={{ ...newDemoGame(), pending }} error={null} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByLabelText("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    expect(onSubmit).toHaveBeenCalledWith({ kind: "yesNo", value: true });
  });

  test("shows the engine's error and the end of the game", () => {
    const { rerender } = render(<DecisionPanel state={newDemoGame()} error="That decision is no longer current" onSubmit={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toBe("That decision is no longer current");

    rerender(<DecisionPanel state={{ ...newDemoGame(), winner: BOB }} error={null} onSubmit={vi.fn()} />);
    expect(screen.getByText("Game over: bob wins.")).toBeTruthy();
  });
});

describe("stack panel", () => {
  test("says so when the stack is empty", () => {
    render(<StackPanel state={newDemoGame()} />);
    expect(screen.getByText("The stack is empty.")).toBeTruthy();
  });

  test("lists entries with the top of the stack first", () => {
    const base = newDemoGame();
    const hand = must(base.players[ALICE]).hand;
    const find = (def: string) => must(hand.find((id) => base.objects[id]?.definitionId === cardDefId(def)));

    const bolt = must(moveObject(base, find("bolt"), "stack"));
    const bear = must(moveObject(bolt.state, find("bear"), "stack"));

    const state: GameState = {
      ...bear.state,
      stack: [
        { kind: "spell", id: 1000 as StackId, controller: ALICE, source: bolt.newId, targets: [{ kind: "player", id: BOB }] },
        {
          kind: "ability",
          id: 1001 as StackId,
          controller: BOB,
          source: bear.newId,
          targets: [],
          effects: [{ kind: "gainLife", who: "controller", amount: 2 }],
        },
      ],
    };
    render(<StackPanel state={state} />);

    const region = screen.getByRole("region", { name: "Stack" });
    const names = [...region.querySelectorAll("ol.stack-list > li > details > summary .name")].map((n) => n.textContent);
    expect(names).toEqual(["Grizzly Bears", "Lightning Bolt"]); // last element of the array is the top
    expect(must(region.querySelector("summary")).textContent).toContain("top");

    const text = region.textContent ?? "";
    expect(text).toContain("deal 3 damage to target 1"); // the spell's effect, read from its card
    expect(text).toContain("player bob"); // its target
    expect(text).toContain("controller gains 2 life"); // the ability's own effects
  });
});
