# MTG rules engine

A personal project: a Magic: The Gathering rules engine in TypeScript, with a debugging UI in React that shows game state. The engine is the point; the UI exists to inspect and drive it.

## Layout

pnpm workspace with three packages:

- `engine/` (`@mtg/engine`): pure rules engine. No UI, no DOM, no I/O.
- `definitions/` (`@mtg/definitions`): card definitions, built with the builders in `src/builders/`. `src/testCards/` holds cards that exist only to exercise engine features.
- `ui/` (`@mtg/engine` + `@mtg/definitions` consumer): Vite + React debugging UI, deployed to GitHub Pages.

## Commands

Run from the repo root:

- `pnpm test`: all package tests (Vitest)
- `pnpm typecheck`: `tsc --noEmit` in every package
- `pnpm dev`: UI dev server

Single package: `pnpm --filter engine test`, `pnpm --filter engine test:watch`.
Before calling any task done, `pnpm typecheck` and `pnpm test` must both pass.

## Engine architecture

**Folder layering (imports go downward only):**

`core/` <- `model/` <- `rules/` <- `flow/`

- `core/`: generic helpers (`ApplyResult`, utilities). Knows nothing about Magic.
- `model/`: data types and pure data helpers (state, zones, abilities, effects, predicates, layers). No rules logic that mutates the game.
- `rules/`: rules logic that is a function of state (costs, targeting, stack, state-based actions, trigger matching, continuous effects, bindings).
- `flow/`: sequencing and player-facing procedures (casting, priority, combat, resolution, turn structure).
- `engine.ts` is the entry point. `index.ts` is the public API; UIs import only from `@mtg/engine`.

Never import upward (`model` must not import `rules`/`flow`; `rules` must not import `flow`).

**State and results:**

- `GameState` is immutable. Functions return a new state; never mutate. ID and timestamp generation goes through `nextID`, which returns `[state, id]`.
- Operations that can fail or emit events return `ApplyResult` (`ok(state, events)` / `fail(reason)`), composed with `applySequentially`. Reasons are shown to the player, so write them as sentences.
- Everything observable emits a `GameEvent`. The log, the UI, and triggers all read events; do not add side channels.

**Player decisions:**

- The engine never asks the UI a question synchronously. It sets `state.pending` (a decision with a continuation) and returns; the caller answers through `submitAnswer`.
- The engine builds the legal options. The UI and AI only pick among them. Validate every submission against the pending decision.
- Mid-resolution decisions (spells, abilities, triggers) use the bindings and continuation framework in `rules/bindings.ts` and `flow/resolution.ts`. Mana abilities that need decisions pause in their own state slot, separate from `state.resolving`.

**Abilities and effects:**

- Spells and abilities resolve through the resolution pipeline (begin / run / finish) using `EffectContext`. New primitive effects go in `rules/primitives.ts` with tests.
- Conditions, targets, and restrictions are predicates over game state, not static values. Prefer extending `model/predicates.ts` and `model/objectPredicates.ts` over special cases.
- Continuous effects go through `rules/continuousEffects.ts` and the layer system in `model/layers.ts`. Respect layer order and timestamps. Characteristics are read from the cached layered characteristics, never from raw card definitions, once an object is in play.
- Prefer the comprehensive rules as the source of truth. When implementing a rule, cite the rule number in a short comment (e.g. `// 601.2f`).

## Conventions

- Engine `tsconfig` is very strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`). Use `import type` for type-only imports. Handle indexed access results; do not silence them with `!`.
- Use `assertNever` for exhaustive switches over unions.
- Formatting: 4-space indent and double quotes.
- Cards are data. Card behavior is expressed with the builders in `definitions/src/builders/`, not by special-casing card names in the engine.
- No engine dependencies on the UI or the definitions package.

## Testing

- Every new rule or effect gets a Vitest test in `engine/tests/`, mirrored to the source folder (`flow/`, `model/`, `rules/`).
- Use `engine/tests/helpers.ts` for setup. If a test needs a card that does not exist, add a minimal one to `definitions/src/testCards/` rather than hand-building objects inline.
- Test the rules, not the implementation: assert on resulting state, events, and pending decisions.
- `ui/` has tests for describe/formatting logic and the demo; keep those passing when engine types change.

## Working style for this repo

- Larger features are done in phases (e.g. resolution, activated abilities, triggers, continuous abilities). Each phase should leave the repo green and add tests before moving on.
- When asked to plan, map the plan onto real files and functions in this repo, not generic structure.
- Say so when something deviates from the comprehensive rules or is deliberately simplified, and note it in a comment near the code.
- Do not expand scope silently. If a change needs a refactor outside the task, propose it first.
- Do not commit or push unless asked.