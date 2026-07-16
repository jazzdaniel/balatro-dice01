/**
 * The starter card pool — modifiers the player acquires into their run's card
 * slots (see Config.cards). Every card here pushes toward inscribing values
 * *other than* six: since score is `(sum + add) × mult` and a raw 6 only grows
 * `sum`, most anti-6 pressure lives in `mult`; blank-focused effects can use
 * additive chips so a dud is still able to score.
 *
 * Values are deliberately simple starting tuning — the whole point of the lab
 * is to rerun with different numbers.
 */

import type { Modifier, ModifierRegistry, ScoreContext } from "./types.js";

function addStep(ctx: ScoreContext, step: ScoreContext["steps"][number]): ScoreContext {
  return { ...ctx, steps: [...ctx.steps, step] };
}

/** Each showing 5 grants +1 Mult. Rewards a die inscribed with 5s over 6s. */
const fiver: Modifier = {
  id: "fiver",
  name: "Fiver",
  description: "Each 5 you roll: +1 Mult.",
  phase: "onFinal",
  apply: (ctx) => {
    const n = ctx.faces.filter((v) => v === 5).length;
    if (n === 0) return ctx;
    return addStep({ ...ctx, mult: ctx.mult + n }, {
      source: "Fiver",
      kind: "mult",
      amount: n,
      note: `${n}×5`,
    });
  },
};

/** Each showing odd face (1/3/5) grants +1 Mult. Punishes all-even (all-6) dice. */
const oddball: Modifier = {
  id: "oddball",
  name: "Oddball",
  description: "Each odd face (1/3/5): +1 Mult.",
  phase: "onFinal",
  apply: (ctx) => {
    const n = ctx.faces.filter((v) => v !== null && v % 2 === 1).length;
    if (n === 0) return ctx;
    return addStep({ ...ctx, mult: ctx.mult + n }, {
      source: "Oddball",
      kind: "mult",
      amount: n,
      note: `${n} odd`,
    });
  },
};

/** +2 Mult per distinct value showing. Weak solo; shines as dice are added. */
const rainbow: Modifier = {
  id: "rainbow",
  name: "Rainbow",
  description: "+2 Mult per distinct value showing (shines with more dice).",
  phase: "onFinal",
  apply: (ctx) => {
    const distinct = new Set(ctx.faces.filter((v) => v !== null));
    if (distinct.size === 0) return ctx;
    const amount = distinct.size * 2;
    return addStep({ ...ctx, mult: ctx.mult + amount }, {
      source: "Rainbow",
      kind: "mult",
      amount,
      note: `${distinct.size} distinct`,
    });
  },
};

/**
 * If you roll a value your die holds 3+ copies of, +4 Mult. Composition-aware:
 * reads `dieFaces`, so it rewards deliberately inscribing duplicates.
 */
const trips: Modifier = {
  id: "trips",
  name: "Trips",
  description: "Roll a value your die has 3+ copies of: +4 Mult.",
  phase: "onFinal",
  apply: (ctx) => {
    const triggered = ctx.faces.some((v, i) => {
      if (v === null) return false;
      const copies = ctx.dieFaces[i]?.filter((f) => f === v).length ?? 0;
      return copies >= 3;
    });
    if (!triggered) return ctx;
    return addStep({ ...ctx, mult: ctx.mult + 4 }, {
      source: "Trips",
      kind: "mult",
      amount: 4,
      note: "3+ of a kind on the die",
    });
  },
};

/** Each showing face adds (6 − its value) Mult — a 1 gives +5, a 6 gives +0. */
const underdog: Modifier = {
  id: "underdog",
  name: "Underdog",
  description: "Each face adds (6 − its value) Mult — a 1 gives +5, a 6 gives +0.",
  phase: "onFinal",
  apply: (ctx) => {
    let amount = 0;
    for (const v of ctx.faces) if (v !== null) amount += 6 - v;
    if (amount === 0) return ctx;
    return addStep({ ...ctx, mult: ctx.mult + amount }, {
      source: "Underdog",
      kind: "mult",
      amount,
      note: "low faces",
    });
  },
};

/** Rolling any dud grants +1 additive chip for every blank face held. */
const blankCheck: Modifier = {
  id: "blank-check",
  name: "Blank Check",
  description: "Roll a blank: +1 Chip for every blank face across your dice.",
  phase: "onScore",
  apply: (ctx) => {
    if (!ctx.faces.some((v) => v === null)) return ctx;
    const amount = ctx.dieFaces.reduce(
      (total, faces) => total + faces.filter((face) => face === null).length,
      0,
    );
    if (amount === 0) return ctx;
    return addStep({ ...ctx, add: ctx.add + amount }, {
      source: "Blank Check",
      kind: "add",
      amount,
      note: `${amount} blank face${amount === 1 ? "" : "s"}`,
    });
  },
};

/** The starter pool, in a stable order. */
export const cardModifiers: readonly Modifier[] = [fiver, oddball, rainbow, trips, underdog, blankCheck];

/** Registry form for `Config.modifiers`. */
export const cardRegistry: ModifierRegistry = Object.fromEntries(
  cardModifiers.map((m) => [m.id, m]),
);
