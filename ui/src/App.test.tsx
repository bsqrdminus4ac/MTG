import { bolt, drake, forest } from "@mtg/definitions";
import { chooseMany, createGame, getCharacteristics, indexChoice, moveObject, orderingDecision, yesNo, type CardDefinition, type DecisionId, type GameState, type StackId } from "@mtg/engine";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, test, vi } from "vitest";
import { App, ProgressState } from "./App";
import { DecisionPanel } from "./components/DecisionPanel";
import { ObjectCard } from "./components/ObjectCard";
import { StackPanel } from "./components/StackPanel";
import { ALICE, BOB, newDemoGame } from "./demo";
import { useGame } from "./useGame";

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

function cardWithText(card: CardDefinition, description: string): CardDefinition {
    const ability = card.abilities[0];
    if (!ability || !("effects" in ability)) throw new Error(`expected effects on ${card.name}`);

    const describedAbility = {
        ...ability,
        text: description,
    };
    return { ...card, abilities: [describedAbility, ...card.abilities.slice(1)] };
}

function gameWithCards(cards: readonly CardDefinition[]): GameState {
    let state = createGame(cards, [
        { id: ALICE, deck: cards.map((card) => card.id) },
        { id: BOB, deck: [] },
    ]);
    for (const card of cards) {
        const id = state.players[ALICE]?.library.find((objectId) => state.objects[objectId]?.definitionId === card.id);
        if (id === undefined) throw new Error(`expected ${card.name} in Alice's library`);
        const moved = moveObject(state, id, "hand");
        if (!moved) throw new Error(`unable to move ${card.name} to Alice's hand`);
        state = moved.state;
    }
    return state;
}

describe("in-progress state panels", () => {
    test("hides states when they are null", () => {
        render(<App />);
        expect(screen.queryByText("Casting")).toBeNull();
        expect(screen.queryByText("Combat")).toBeNull();
        expect(screen.queryByText("Resolving")).toBeNull();
    });

    test("shows progress JSON while abbreviating rollback state", async () => {
        render(<ProgressState title="Casting" value={{ player: "Alice", rollback: { privateState: "omit this" } }} />);
        const casting = screen.getByText("Casting");
        const panel = must(casting.closest("details"));
        fireEvent.click(casting);
        await waitFor(() => {
            const json = panel.querySelector("pre")?.textContent;
            expect(json).toContain('"player": "Alice"');
            expect(json).toContain('"rollback": "[...]"');
            expect(json).not.toContain("omit this");
        });
    });
});

describe("new game", () => {
    test("starts the selected activation test scenario", () => {
        render(<App />);
        fireEvent.change(screen.getByLabelText("New game type"), { target: { value: "activation" } });
        fireEvent.click(screen.getByRole("button", { name: "New game" }));

        expect(screen.getByText("New game: activation test scenario")).toBeTruthy();
    });

    test("starts the selected triggered ability test scenario", () => {
        render(<App />);
        fireEvent.change(screen.getByLabelText("New game type"), { target: { value: "triggers" } });
        fireEvent.click(screen.getByRole("button", { name: "New game" }));

        expect(screen.getByText("New game: triggered ability test scenario")).toBeTruthy();
    });

    test("starts the selected continuous ability test scenario", () => {
        render(<App />);
        fireEvent.change(screen.getByLabelText("New game type"), { target: { value: "continuous" } });
        fireEvent.click(screen.getByRole("button", { name: "New game" }));

        expect(screen.getByText("New game: continuous ability test scenario")).toBeTruthy();
    });
});

describe("decision submission", () => {
    test("ignores a duplicate answer submitted for a decision that has already advanced", () => {
        const { result } = renderHook(() => useGame(), { wrapper: StrictMode });
        const initialDecision = result.current.state.pending;
        if (initialDecision?.kind !== "priority") throw new Error("Expected an opening priority decision");
        const pass = initialDecision.options.find((option) => option.action.type === "passPriority");
        if (!pass) throw new Error("Expected a pass priority option");
        const answer = { kind: "priority" as const, option: pass.id };

        act(() => {
            result.current.submit(answer, initialDecision.id);
            result.current.submit(answer, initialDecision.id);
        });

        expect(result.current.state.pending).toMatchObject({ kind: "priority", player: BOB });
        expect(result.current.error).toBeNull();
        expect(result.current.history.submissions).toHaveLength(1);
    });
});

describe("zones", () => {
    test("each player gets their own containers for each zone", () => {
        render(<App />);
        for (const player of [ALICE, BOB]) {
            const region = playerRegion(player);
            for (const zone of ["Hand", "Library", "Battlefield", "Graveyard"]) {
                expect(zoneOf(region, zone)).toBeTruthy();
            }
        }
    });

    test("an element lists its properties as bullets", () => {
        render(<App />);
        const card = must(cardsIn(zoneOf(playerRegion(ALICE), "Hand"))[0]);
        const bullets = [...card.querySelectorAll(".bullets > li")].map((li) => li.textContent);
        expect(bullets).toContain("OwnerAlice");
        expect(bullets).toContain("ControllerAlice");
        expect(bullets).toContain("Zonehand");
        expect(bullets).toContain("Tappedno");
        expect(bullets.some((b) => b?.startsWith("Abilities"))).toBe(true);
    });

    test("shows authored effect text under Card Text and replaces the this placeholder", () => {
        const state = gameWithCards([cardWithText(forest, "<this> taps to add one green mana.")]);
        const id = must(state.players[ALICE]!.hand.find((id) => state.objects[id]?.definitionId === forest.id));
        render(<ObjectCard state={state} id={id} />);

        expect(screen.getByText("Card Text")).toBeTruthy();
        const cardText = screen.getByText("Forest taps to add one green mana.", { selector: ".obj-card-text" });
        expect(cardText).toBeTruthy();
        const summary = must(cardText.closest("summary"));
        expect(summary.querySelector(".name")?.textContent).toBe("Forest");
        expect(summary.querySelector(".obj-card-text")?.textContent).toBe("Forest taps to add one green mana.");
        expect(screen.getByText("{T} → add 1× {G}")).toBeTruthy();
    });

    test("includes keyword abilities in the collapsed card text", () => {
        const state = newDemoGame();
        const id = must(state.players[ALICE]!.hand.find((id) => state.objects[id]?.definitionId === drake.id));
        render(<ObjectCard state={state} id={id} />);

        expect(screen.getByText("Flying", { selector: ".obj-card-text" })).toBeTruthy();
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
        expect(within(panel).getByText("Alice must answer")).toBeTruthy();

        const submit = within(panel).getByRole<HTMLButtonElement>("button", { name: "Submit answer" });
        expect(submit.disabled).toBe(true);

        fireEvent.click(within(panel).getByLabelText(/Pass priority/));
        expect(submit.disabled).toBe(false);
        fireEvent.click(submit);

        expect(within(panel).getByText("Bob must answer")).toBeTruthy();
        expect(within(panel).getByRole<HTMLButtonElement>("button", { name: "Submit answer" }).disabled).toBe(true);
        expect(within(screen.getByRole("region", { name: "Log" })).getByText("Alice: Pass priority")).toBeTruthy();
    });

    test("auto-pass stops at the first real choice, and a land can be played from it", () => {
        render(<App />);
        fireEvent.click(screen.getByRole("button", { name: "Auto-pass" }));

        const steps = screen.getByRole("list", { name: "Turn steps" });
        expect(steps.querySelector("li.on")?.textContent).toBe("precombatMain");

        const panel = screen.getByRole("region", { name: "Decision" });
        expect(within(panel).getByText("Alice must answer")).toBeTruthy();
        fireEvent.click(must(within(panel).getAllByLabelText(/^Play /)[0]));
        fireEvent.click(within(panel).getByRole("button", { name: "Submit answer" }));

        const region = playerRegion(ALICE);
        expect(cardsIn(zoneOf(region, "Battlefield"))).toHaveLength(1);
        expect(cardsIn(zoneOf(region, "Hand"))).toHaveLength(6);
        expect(screen.getByText("state consistent")).toBeTruthy();
        // The land drop is used up, so alice still has priority but only "pass" is left.
        expect(within(panel).queryAllByLabelText(/^Play /)).toHaveLength(0);
    });

    test("force pass continues across priority passes and stops at the next turn", () => {
        render(<App />);
        const panel = screen.getByRole("region", { name: "Decision" });

        fireEvent.click(within(playerRegion(BOB)).getByRole("button", { name: "Force pass" }));
        expect(within(playerRegion(BOB)).getByRole("button", { name: "Stop force pass" }).className).toBe("force-pass-enabled");
        fireEvent.click(within(playerRegion(ALICE)).getByRole("button", { name: "Force pass" }));

        expect(screen.getByText("2", { selector: ".turn b" })).toBeTruthy();
        for (const player of [ALICE, BOB]) {
            expect(within(playerRegion(player)).getByRole("button", { name: "Force pass" })).toBeTruthy();
        }
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

    test("an ordering decision submits the dragged option order", () => {
        const pending = orderingDecision({
            id: 903 as DecisionId,
            player: ALICE,
            prompt: "Set the order",
            options: [indexChoice(0, "First"), indexChoice(1, "Second"), indexChoice(2, "Third")],
            then: { kind: "discardToHandSize" },
        });
        const onSubmit = vi.fn();
        render(<DecisionPanel state={{ ...newDemoGame(), pending }} error={null} onSubmit={onSubmit} />);

        const orderingRows = () => [...document.querySelectorAll<HTMLElement>(".ordering-option .opt-label")].map((label) => label.textContent);
        const draggableRows = () => screen.getAllByRole("listitem").filter((row) => row.hasAttribute("draggable"));
        const dataTransfer = {
            effectAllowed: "none",
            dropEffect: "none",
            setData: vi.fn(),
        };

        expect(orderingRows()).toEqual(["First", "Second", "Third"]);
        fireEvent.click(screen.getByRole("button", { name: "Move Second up" }));
        expect(orderingRows()).toEqual(["Second", "First", "Third"]);

        const rows = draggableRows();
        fireEvent.dragStart(rows[1]!, { dataTransfer });
        fireEvent.dragOver(rows[2]!, { dataTransfer });
        fireEvent.drop(rows[2]!, { dataTransfer });
        expect(orderingRows()).toEqual(["Second", "Third", "First"]);

        fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
        expect(onSubmit).toHaveBeenCalledWith({ kind: "order", order: [1, 2, 0] });
    });

    test("a cancelable decision submits a cancel answer", () => {
        const pending = yesNo({
            id: 901 as DecisionId,
            player: BOB,
            prompt: "Keep this hand?",
            then: { kind: "discardToHandSize" },
            onCancel: { kind: "cancelAbility" },
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
        expect(screen.getByText("Game over: Bob wins.")).toBeTruthy();
    });
});

describe("stack panel", () => {
    test("says so when the stack is empty", () => {
        render(<StackPanel state={newDemoGame()} />);
        expect(screen.getByText("The stack is empty.")).toBeTruthy();
    });

    test("lists entries with the top of the stack first", () => {
        const base = gameWithCards([cardWithText(bolt, "<this> deals three damage."), cardWithText(forest, "<this> taps for green mana.")]);
        const hand = must(base.players[ALICE]).hand;
        const find = (def: CardDefinition) => must(hand.find((id) => base.objects[id]?.definitionId === def.id));

        const boltOnStack = must(moveObject(base, find(bolt), "stack"));
        const forestOnStack = must(moveObject(boltOnStack.state, find(forest), "stack"));
        const boltCharacteristics = must(getCharacteristics(forestOnStack.state, boltOnStack.newId));
        const boltAbility = must(boltCharacteristics.abilities.find((ability) => ability.kind === "spell"));
        const forestObject = must(forestOnStack.state.objects[forestOnStack.newId]);
        const forestCharacteristics = must(getCharacteristics(forestOnStack.state, forestOnStack.newId));
        const forestAbility = must(forestCharacteristics.abilities.find((ability) => ability.kind === "activated"));

        const state: GameState = {
            ...forestOnStack.state,
            stack: [
                {
                    kind: "spell",
                    id: 1000 as StackId,
                    controller: ALICE,
                    source: boltOnStack.newId,
                    targets: [[{ kind: "player", id: BOB }]],
                    ability: boltAbility,
                    bindings: {},
                },
                {
                    kind: "ability",
                    id: 1001 as StackId,
                    controller: BOB,
                    source: forestOnStack.newId,
                    targets: [],
                    ability: forestAbility,
                    sourceSnapshot: {
                        id: forestOnStack.newId,
                        chars: { ...forestCharacteristics, name: "Snapshot Forest" },
                        controller: forestObject.controller,
                        owner: forestObject.owner,
                        counters: forestObject.counters,
                        damage: forestObject.damage,
                        zone: forestObject.zone,
                        tapped: forestObject.tapped,
                    },
                    bindings: {},
                },
            ],
        };
        render(<StackPanel state={state} />);

        const region = screen.getByRole("region", { name: "Stack" });
        const names = [...region.querySelectorAll("ol.stack-list > li > details > summary .name")].map((n) => n.textContent);
        expect(names).toEqual(["Snapshot Forest's ability", "Lightning Bolt"]); // last element of the array is the top
        expect(must(region.querySelector("summary")).textContent).toContain("top");
        expect(region.querySelector("summary .stack-ability-text")?.textContent).toContain("Snapshot Forest taps for green mana.");
        expect(region.querySelectorAll("summary .stack-ability-text")[1]?.textContent).toContain("Lightning Bolt deals three damage.");

        const text = region.textContent ?? "";
        expect(text).toContain("deal 3 damage to target 1"); // the spell's effect, read from its card
        expect(text).toContain("Card TextLightning Bolt deals three damage.");
        expect(text).toContain("player Bob"); // its target
        expect(text).toContain("add 1× {G}"); // the ability is read from its source card
    });
});
