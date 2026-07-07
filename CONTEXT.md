# CONTEXT — Roguelike-Dice Engine

A headless, deterministic, data-driven **roguelike-dice engine**. It exists first as a **lab** for exploring matches and scores; a playable UI is a later consumer, not part of the core.

The precious, upgradeable entity is a **single die** the player builds face by face and grows attached to. The roguelike fantasy lives in the die itself, and the emotional pillar is the **pain of trading away a die you invested in**.

This document is the project's shared design understanding and its glossary. When naming a domain concept anywhere (code, tests, issues, PRDs), use the term as defined here.

---

## Glossary (ubiquitous language)

- **Die** — a persistent, identity-bearing entity with six **faces**. Not a transient roll. Carries identity, faces-as-data, attached **enchantments**, and investment history.
- **Face** — one of a die's six sides. Starts **blank**; gets an inscribed **value** (1–6).
- **Blank face** — an un-inscribed face. Rolls as a **dud** worth **0**.
- **Inscribe** — assign a value (1–6) to a face. **Blank-fill** (inscribing a blank face) is the common reward; **overwrite** (re-inscribing an already-filled face) is a rare, separate reward.
- **Turn** — the atomic act of producing a score: **roll → optionally reroll a held subset (within the reroll budget) → lock in → score**.
- **Reroll budget** — the limited number of rerolls available in a turn; the main mitigation for landing on blank faces.
- **Lock in** — end rerolling and score the final faces.
- **Modifier** (a.k.a. enchantment) — a data-described effect that plugs into the scoring pipeline. Where combination logic and most depth live.
- **Card** — a modifier held in one of the run's **card slots**. Cards apply globally (to every scoring), independent of which die rolled.
- **Card slot** — one of a capped number of global modifier slots (starts at 3, tunable). Taking a card past the cap forces you to **discard** one you hold — gone forever, echoing the trade's opportunity-cost pain.
- **Scoring pipeline** — an ordered hook sequence (`onRoll → onScore → onFinal`, minimal to start) that builds a scoring context and produces an inspectable **breakdown**.
- **Round** — a unit of the run with a **score target** and a **turn budget**. Scores accumulate toward the target.
- **Reward step** — between rounds; the player picks one of a few offered options (inscribe, enchant, add die, trade die).
- **Run** — a sequence of rounds with monotonically rising targets. Ends (death) on failing to hit a target within the turn budget.
- **Trade** — voluntarily swapping a die for a tempting new one. What you give up is **gone forever**.
- **Match** — a fully replayable record: `{ seed, config, actions[] }`.

---

## Core design decisions

### The die (the heart)
- Starts **blank** — six empty faces. The player inscribes faces one at a time, choosing which face gets which value (1–6).
- A **blank face rolls as 0**. Filling faces is the core power growth; a fully-inscribed die is the "complete" feeling.
- **Duplicates allowed** — the same value may be inscribed on multiple faces (a consistency strategy: higher floor, lower ceiling, easier matching).
- **Blank-fill is common; overwrite is rare and separate**, so a die stays mostly a record of committed choices without permanently punishing an early mistake.

### The turn
`roll → optionally reroll a held subset (within reroll budget) → lock in → score`. With one die there is no held subset — only "reroll or not." Holding a subset becomes meaningful at 2+ dice.

### Scoring
`score = (sumOfFaces + add) × mult`, where blanks contribute 0, `add` starts at 0, `mult` starts at 1, both moved by modifiers. **Combinations are not built in** — matching effects (e.g. "two faces match → +mult") are acquirable modifiers.

### Cards & slots
Modifiers are acquired as **cards** into a capped set of **global slots** (3 to start). The reward step offers a few cards; picking one when slots are full forces a **discard** of a held card. Because score is `(sum + add) × mult` and a raw 6 only grows `sum`, the starter pool pushes players *away* from all-6 dice by paying out through `mult` (value-, parity-, diversity-, and repeat-keyed cards). Card values live in the config/registry — tuning, not engine code.

### Modifiers
A **small ordered hook pipeline**. Each modifier declares its phase and is effectively a pure function `(context) => context` plus metadata (name, description, source). Ordering is explicit and deterministic (compute sum → additive effects → multiplicative; among peers, fixed order such as acquisition order). Scoring emits a **step-by-step breakdown** ("sum 7, +4 from Twin, ×2 from Lucky Six → 22"). Keep the hook set minimal; add hooks only when an experiment needs one.

### Run structure
Rounds with rising targets → a **turn budget** per round → scores accumulate toward the target → **reward step** between rounds → **death** on failure. **No currency** in v1 (pick-one-reward). Boss/ante rule-warping is **deferred** to later data experiments.

### The painful trade
Dice are **capped** (1 → 2 → 3, maybe 4). Trades are **voluntary**, driven by a genuinely tempting new die (more faces, innate enchantment, partial inscription). What you give up — the die and all its inscriptions/enchantments — is **gone forever**. The pain is opportunity cost made concrete, not a penalty imposed by the game.

---

## Architecture

### Determinism / RNG
- A **master seed** derives **named streams** (at minimum `dice` and `rewards`, with room for more, e.g. `procs`), each seeded deterministically (`hash(masterSeed + streamName)`) and independently serializable. Tweaking one stream never reshuffles another — isolation from day one.
- **No `Math.random()`** anywhere in the engine. The engine ships its own tiny deterministic PRNG (e.g. mulberry32/xorshift), zero deps.

### API shape (the lab payoff)
- **State** is one **immutable, serializable** object (dice, faces, round/target, turn budget, RNG stream states, acquired modifiers, score breakdown) — `JSON.stringify`-able, diffable, storable.
- Advance via **pure action reducer**: `(state, action) => newState`. Actions include `roll`, `reroll(heldDiceIds)`, `lockIn`, `inscribeFace(dieId, faceIndex, value)`, `chooseReward(id)`, `tradeDie(...)`. No hidden mutation, no callbacks.
- Reads via **selectors**: `getLegalActions(state)`, `getScoreBreakdown(state)`, `getDice(state)`, etc. The engine never renders anything itself.
- A **match = `{ seed, config, actions[] }`**, replayable to any state. "Explore matches" = generate/replay action logs and inspect resulting states and breakdowns.
- A UI later just **dispatches actions and renders selectors** — no rework.

### Stack
TypeScript, **zero-dep core**, **Vitest**. Strict TS; the public API is fully typed so consumers get autocomplete and compile-time safety. Types double as documentation.

### Configuration
Tuning lives in **typed TS config objects** checked into the repo (v1). Revisit external JSON (hot-swappable, loses compile-time typing) only if the experiment cadence demands it.

---

## Deliberately open (lab knobs, not gaps)

These live in config/data precisely so they can be tuned and rerun without touching engine code:

- Exact **dice cap** (3 vs 4), **reroll budget**, and the **target curve** per round.
- **Reward-pool contents** and the **specific modifiers** available.

## Deferred (later data-driven experiments)
- Currency / shop economy.
- Boss/ante rule-warping.
- Named RNG stream splits beyond the initial set (structure is in place; new streams added by name).
