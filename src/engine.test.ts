import { describe, expect, it } from "vitest";
import { createRng, drawInt } from "./rng.js";
import { createInitialState, reduce, replay } from "./reducer.js";
import { getLegalActions, getLastScore } from "./selectors.js";
import { exampleConfig } from "./example-config.js";
import type { Action, FaceValue } from "./types.js";

/** Inscribe all six faces of a die to the same value. */
function inscribeAll(dieId: string, value: FaceValue): Action[] {
  return Array.from({ length: 6 }, (_, faceIndex) => ({
    type: "inscribeFace" as const,
    dieId,
    faceIndex,
    value,
  }));
}

describe("rng", () => {
  it("is deterministic per seed", () => {
    const a = createRng("seed-1", ["dice"]);
    const b = createRng("seed-1", ["dice"]);
    expect(drawInt(a, "dice", 6).value).toBe(drawInt(b, "dice", 6).value);
  });

  it("keeps named streams independent", () => {
    const rng = createRng("seed-1", ["dice", "rewards"]);
    // Drawing from `rewards` must not disturb the `dice` stream.
    const afterReward = drawInt(rng, "rewards", 6).rng;
    expect(drawInt(rng, "dice", 6).value).toBe(drawInt(afterReward, "dice", 6).value);
  });

  it("throws on an undeclared stream", () => {
    const rng = createRng("seed-1", ["dice"]);
    expect(() => drawInt(rng, "rewards", 6)).toThrow(/Unknown RNG stream/);
  });
});

describe("reducer", () => {
  it("scores a fully-inscribed die deterministically", () => {
    let state = createInitialState("seed-1", exampleConfig);
    for (const action of inscribeAll("die-0", 6)) state = reduce(state, action);
    state = reduce(state, { type: "roll" });
    state = reduce(state, { type: "lockIn" });
    // Every face is 6, no acquired modifiers → (6 + 0) * 1 = 6.
    expect(getLastScore(state)?.total).toBe(6);
  });

  it("applies acquired modifiers via the pipeline", () => {
    let state = createInitialState("seed-1", exampleConfig);
    state = { ...state, acquiredModifiers: ["lucky-six"] };
    for (const action of inscribeAll("die-0", 6)) state = reduce(state, action);
    state = reduce(state, { type: "roll" });
    state = reduce(state, { type: "lockIn" });
    // (6 + 10) * 1 = 16.
    expect(getLastScore(state)?.total).toBe(16);
  });

  it("surfaces legal actions per phase", () => {
    let state = createInitialState("seed-1", exampleConfig);
    expect(getLegalActions(state)).toContain("roll");
    state = reduce(state, { type: "roll" });
    expect(getLegalActions(state)).toEqual(expect.arrayContaining(["lockIn", "reroll"]));
  });

  it("blank faces roll as duds worth 0", () => {
    let state = createInitialState("seed-1", exampleConfig);
    // Never inscribe — the single die is all blanks.
    state = reduce(state, { type: "roll" });
    state = reduce(state, { type: "lockIn" });
    expect(getLastScore(state)?.total).toBe(0);
  });
});

describe("replay", () => {
  it("reproduces state from seed + config + actions", () => {
    const actions: Action[] = [
      ...inscribeAll("die-0", 4),
      { type: "roll" },
      { type: "lockIn" },
    ];
    const match = { seed: "seed-42", config: exampleConfig, actions };
    expect(replay(match)).toEqual(replay(match));
  });
});
