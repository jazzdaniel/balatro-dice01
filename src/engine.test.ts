import { describe, expect, it } from "vitest";
import { createRng, drawInt } from "./rng.js";
import { createInitialState, reduce, replay } from "./reducer.js";
import { getLegalActions, getLastScore, getScorePreview } from "./selectors.js";
import { exampleConfig } from "./example-config.js";
import { cardRegistry } from "./cards.js";
import type { Action, Config, FaceValue, GameState } from "./types.js";

/** A config whose modifier pool is the real starter card set, with an easy target. */
const cardConfig: Config = {
  ...exampleConfig,
  modifiers: cardRegistry,
  targetForRound: () => 5,
};

/** A one-die turn frozen on a chosen face — lets us score without RNG. */
function turnShowing(state: GameState, faceIndex: number): GameState {
  return {
    ...state,
    turn: { roll: [{ dieId: "die-0", faceIndex }], rerollsRemaining: 0 },
  };
}

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

describe("cards (modifier economy)", () => {
  it("offers cards on round clear and acquires the chosen one", () => {
    let state = createInitialState("seed-1", cardConfig);
    for (const action of inscribeAll("die-0", 6)) state = reduce(state, action);
    // Clear round 1 (target 20): 6 per turn isn't enough in one turn, so loop.
    while (state.phase === "rolling") {
      state = reduce(state, { type: "roll" });
      state = reduce(state, { type: "lockIn" });
    }
    expect(state.phase).toBe("reward");
    expect(state.rewardOffers.length).toBe(3);
    const offer = state.rewardOffers[0]!;
    state = reduce(state, { type: "chooseReward", rewardId: offer.id });
    expect(state.acquiredModifiers).toEqual([offer.modifierId]);
    expect(state.rewardOffers).toEqual([]);
  });

  it("caps at the slot count and forces a discard when full", () => {
    let state = createInitialState("seed-1", cardConfig);
    state = {
      ...state,
      phase: "reward",
      acquiredModifiers: ["fiver", "oddball", "underdog"],
      rewardOffers: [
        { id: "card:rainbow", kind: "card", modifierId: "rainbow", description: "Rainbow" },
      ],
    };
    // Full slots, no discard specified → refused.
    expect(() => reduce(state, { type: "chooseReward", rewardId: "card:rainbow" })).toThrow(/full/);
    // With a discard, the named card is swapped out.
    const after = reduce(state, { type: "chooseReward", rewardId: "card:rainbow", discard: "fiver" });
    expect(after.acquiredModifiers).toEqual(["oddball", "underdog", "rainbow"]);
  });

  it("Fiver makes a single 5 outscore a raw 6", () => {
    let state = createInitialState("seed-1", cardConfig);
    state = reduce(state, { type: "inscribeFace", dieId: "die-0", faceIndex: 0, value: 5 });
    state = { ...state, acquiredModifiers: ["fiver"] };
    // sum 5, mult 1 + 1 = 2 → 10, beating an all-6 die's 6.
    expect(getScorePreview(turnShowing(state, 0))?.total).toBe(10);
  });

  it("Trips reads die composition, not just the roll", () => {
    let state = createInitialState("seed-1", cardConfig);
    for (const fi of [0, 1, 2]) {
      state = reduce(state, { type: "inscribeFace", dieId: "die-0", faceIndex: fi, value: 3 });
    }
    state = { ...state, acquiredModifiers: ["trips"] };
    // Die holds three 3s; showing a 3 → sum 3, mult 1 + 4 = 5 → 15.
    expect(getScorePreview(turnShowing(state, 0))?.total).toBe(15);
    // Showing a blank face (index 5) → no trigger → sum 0.
    expect(getScorePreview(turnShowing(state, 5))?.total).toBe(0);
  });

  it("Rainbow counts distinct inscribed faces regardless of the rolled face", () => {
    let state = createInitialState("seed-1", cardConfig);
    for (const [faceIndex, value] of ([1, 2, 3] as FaceValue[]).entries()) {
      state = reduce(state, { type: "inscribeFace", dieId: "die-0", faceIndex, value });
    }
    state = { ...state, acquiredModifiers: ["rainbow"] };
    // Three distinct inscriptions always give +6 Mult, even when a blank lands.
    expect(getScorePreview(turnShowing(state, 5))?.mult).toBe(7);
    expect(getScorePreview(turnShowing(state, 0))?.total).toBe(7);
  });

  it("Blank Check scores each held blank only when a blank is rolled", () => {
    let state = createInitialState("seed-1", cardConfig);
    state = reduce(state, { type: "inscribeFace", dieId: "die-0", faceIndex: 0, value: 4 });
    state = { ...state, acquiredModifiers: ["blank-check"] };
    // Five blank faces held and a blank showing: (0 + 5) × 1 = 5.
    const blank = getScorePreview(turnShowing(state, 5));
    expect(blank?.total).toBe(5);
    expect(blank?.steps).toContainEqual(expect.objectContaining({ source: "Blank Check", amount: 5 }));
    // A non-blank roll does not trigger the card.
    expect(getScorePreview(turnShowing(state, 0))?.total).toBe(4);
  });

  it("Clean Finish rewards a die only after every face is inscribed", () => {
    let state = createInitialState("seed-1", cardConfig);
    state = { ...state, acquiredModifiers: ["clean-finish"] };
    for (const action of inscribeAll("die-0", 2)) state = reduce(state, action);
    expect(getScorePreview(turnShowing(state, 0))?.total).toBe(6);
  });

  it("Carbon Copy adds chips for every matching inscription", () => {
    let state = createInitialState("seed-1", cardConfig);
    for (const faceIndex of [0, 1, 2]) {
      state = reduce(state, { type: "inscribeFace", dieId: "die-0", faceIndex, value: 4 });
    }
    state = { ...state, acquiredModifiers: ["carbon-copy"] };
    expect(getScorePreview(turnShowing(state, 0))?.total).toBe(7);
  });

  it("Lone Wolf rewards a unique inscription but not a duplicate", () => {
    let state = createInitialState("seed-1", cardConfig);
    state = reduce(state, { type: "inscribeFace", dieId: "die-0", faceIndex: 0, value: 2 });
    state = reduce(state, { type: "inscribeFace", dieId: "die-0", faceIndex: 1, value: 3 });
    state = reduce(state, { type: "inscribeFace", dieId: "die-0", faceIndex: 2, value: 3 });
    state = { ...state, acquiredModifiers: ["lone-wolf"] };
    expect(getScorePreview(turnShowing(state, 0))?.total).toBe(6);
    expect(getScorePreview(turnShowing(state, 1))?.total).toBe(3);
  });

  it("Middle Child gives 3 and 4 rolls +2 Mult", () => {
    let state = createInitialState("seed-1", cardConfig);
    state = reduce(state, { type: "inscribeFace", dieId: "die-0", faceIndex: 0, value: 3 });
    state = reduce(state, { type: "inscribeFace", dieId: "die-0", faceIndex: 1, value: 5 });
    state = { ...state, acquiredModifiers: ["middle-child"] };
    expect(getScorePreview(turnShowing(state, 0))?.total).toBe(9);
    expect(getScorePreview(turnShowing(state, 1))?.total).toBe(5);
  });

  it("Variety Pack counts distinct inscriptions and caps its bonus at +4 Mult", () => {
    let state = createInitialState("seed-1", cardConfig);
    for (const [faceIndex, value] of ([1, 2, 3, 4, 5] as FaceValue[]).entries()) {
      state = reduce(state, { type: "inscribeFace", dieId: "die-0", faceIndex, value });
    }
    state = { ...state, acquiredModifiers: ["variety-pack"] };
    const preview = getScorePreview(turnShowing(state, 0));
    expect(preview?.mult).toBe(5);
    expect(preview?.total).toBe(5);
    expect(preview?.steps).toContainEqual(expect.objectContaining({ source: "Variety Pack", amount: 4 }));
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

