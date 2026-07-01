# balatro-dice-engine

A headless, deterministic, data-driven **roguelike-dice engine** — a lab for exploring matches and scores. The precious, upgradeable entity is a single die you build face by face.

See [`CONTEXT.md`](./CONTEXT.md) for the full design and glossary.

## Install

```bash
npm install
```

## Commands

```bash
npm test          # run the Vitest suite
npm run test:watch
npm run typecheck # tsc --noEmit
npm run build     # emit dist/ (ESM + .d.ts) via tsup
```

## Shape

- **Immutable state + pure reducer.** `reduce(state, action) => newState`; no hidden mutation.
- **Selectors** for reads: `getLegalActions`, `getScorePreview`, `getLastScore`, `getDice`.
- **Deterministic.** A match is `{ seed, config, actions[] }` and `replay(match)` reproduces it exactly. Named RNG streams (`dice`, `rewards`, …) keep randomness axes isolated.
- **Data-driven scoring.** `(sum + add) × mult`; combinations and depth live in modifiers that plug into an ordered hook pipeline and emit a step-by-step breakdown.

```ts
import { createInitialState, reduce, getLastScore } from "balatro-dice-engine";
import { exampleConfig } from "./src/example-config.js";

let s = createInitialState("seed-1", exampleConfig);
s = reduce(s, { type: "inscribeFace", dieId: "die-0", faceIndex: 0, value: 6 });
s = reduce(s, { type: "roll" });
s = reduce(s, { type: "lockIn" });
console.log(getLastScore(s));
```

## Status

Core loop (roll → reroll → lock → score), inscribing faces, the scoring pipeline, and deterministic replay are implemented. The **reward economy** (`chooseReward`, `tradeDie`) is stubbed — the next build step.
