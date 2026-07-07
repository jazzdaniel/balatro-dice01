/**
 * An example tuning config — the lab's knobs live here as typed TS. Copy and
 * tweak to run experiments; the engine code never changes.
 */

import type { Config, Modifier, ScoreContext } from "./types.js";

function addStep(ctx: ScoreContext, step: ScoreContext["steps"][number]): ScoreContext {
  return { ...ctx, steps: [...ctx.steps, step] };
}

/** onScore: every showing 6 adds +10 to the additive term. */
const luckySix: Modifier = {
  id: "lucky-six",
  name: "Lucky Six",
  description: "Each showing 6 adds +10.",
  phase: "onScore",
  apply: (ctx) => {
    const sixes = ctx.faces.filter((v) => v === 6).length;
    if (sixes === 0) return ctx;
    const amount = sixes * 10;
    return addStep({ ...ctx, add: ctx.add + amount }, {
      source: "Lucky Six",
      kind: "add",
      amount,
      note: `${sixes}×6`,
    });
  },
};

/** onFinal: if any two showing faces match, +4 mult. */
const twin: Modifier = {
  id: "twin",
  name: "Twin",
  description: "If two dice show the same value, +4 mult.",
  phase: "onFinal",
  apply: (ctx) => {
    const seen = new Set<number>();
    let hasMatch = false;
    for (const v of ctx.faces) {
      if (v === null) continue;
      if (seen.has(v)) hasMatch = true;
      seen.add(v);
    }
    if (!hasMatch) return ctx;
    return addStep({ ...ctx, mult: ctx.mult + 4 }, {
      source: "Twin",
      kind: "mult",
      amount: 4,
      note: "matching faces",
    });
  },
};

export const exampleConfig: Config = {
  dice: { startingCount: 1, cap: 3 },
  reroll: { budget: 2 },
  cards: { slots: 3, offerCount: 3 },
  targetForRound: (round) => 20 * round,
  turnsPerRound: 3,
  rngStreams: ["dice", "rewards"],
  modifiers: { [luckySix.id]: luckySix, [twin.id]: twin },
};
