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

/** +2 Mult per distinct value inscribed across the dice, regardless of roll. */
const rainbow: Modifier = {
  id: "rainbow",
  name: "Rainbow",
  description: "+2 Mult per distinct value inscribed on your dice.",
  phase: "onFinal",
  apply: (ctx) => {
    const distinct = new Set(ctx.dieFaces.flat().filter((v) => v !== null));
    if (distinct.size === 0) return ctx;
    const amount = distinct.size * 2;
    return addStep({ ...ctx, mult: ctx.mult + amount }, {
      source: "Rainbow",
      kind: "mult",
      amount,
      note: `${distinct.size} distinct inscriptions`,
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

/** A fixed payout for landing on any dud, independent of die composition. */
const dudDividend: Modifier = {
  id: "dud-dividend",
  name: "Dud Dividend",
  description: "Roll a blank: +6 Chips.",
  phase: "onScore",
  apply: (ctx) => {
    if (!ctx.faces.some((value) => value === null)) return ctx;
    return addStep({ ...ctx, add: ctx.add + 6 }, {
      source: "Dud Dividend",
      kind: "add",
      amount: 6,
      note: "blank face payout",
    });
  },
};

/** A fully inscribed die earns a reliable late-game multiplier. */
const cleanFinish: Modifier = {
  id: "clean-finish",
  name: "Clean Finish",
  description: "If your die has no blank faces: +2 Mult.",
  phase: "onFinal",
  apply: (ctx) => {
    const complete = ctx.dieFaces.length > 0 && ctx.dieFaces.every((faces) => faces.every((face) => face !== null));
    if (!complete) return ctx;
    return addStep({ ...ctx, mult: ctx.mult + 2 }, {
      source: "Clean Finish",
      kind: "mult",
      amount: 2,
      note: "fully inscribed die",
    });
  },
};

/** Repeated inscriptions provide a gradual additive payoff. */
const carbonCopy: Modifier = {
  id: "carbon-copy",
  name: "Carbon Copy",
  description: "+1 Chip for every copy of the rolled value on your die.",
  phase: "onScore",
  apply: (ctx) => {
    const amount = ctx.faces.reduce((total, value, i) => {
      if (value === null) return total;
      return total + (ctx.dieFaces[i]?.filter((face) => face === value).length ?? 0);
    }, 0);
    if (amount === 0) return ctx;
    return addStep({ ...ctx, add: ctx.add + amount }, {
      source: "Carbon Copy",
      kind: "add",
      amount,
      note: `${amount} matching inscription${amount === 1 ? "" : "s"}`,
    });
  },
};

/** A one-off inscription gets paid for staying unique. */
const loneWolf: Modifier = {
  id: "lone-wolf",
  name: "Lone Wolf",
  description: "If the rolled value appears only once on your die: +4 Chips.",
  phase: "onScore",
  apply: (ctx) => {
    const triggers = ctx.faces.reduce((total, value, i) => {
      if (value === null) return total;
      const copies = ctx.dieFaces[i]?.filter((face) => face === value).length ?? 0;
      return total + (copies === 1 ? 1 : 0);
    }, 0);
    if (triggers === 0) return ctx;
    const amount = triggers * 4;
    return addStep({ ...ctx, add: ctx.add + amount }, {
      source: "Lone Wolf",
      kind: "add",
      amount,
      note: "unique rolled value",
    });
  },
};

/** Give the currently underserved middle faces a strong identity. */
const middleChild: Modifier = {
  id: "middle-child",
  name: "Middle Child",
  description: "Each 3 or 4 you roll: +2 Mult.",
  phase: "onFinal",
  apply: (ctx) => {
    const hits = ctx.faces.filter((value) => value === 3 || value === 4).length;
    if (hits === 0) return ctx;
    const amount = hits * 2;
    return addStep({ ...ctx, mult: ctx.mult + amount }, {
      source: "Middle Child",
      kind: "mult",
      amount,
      note: `${hits} middle face${hits === 1 ? "" : "s"}`,
    });
  },
};

/** Diverse inscriptions build Mult, capped so a completed rainbow stays sane. */
const varietyPack: Modifier = {
  id: "variety-pack",
  name: "Variety Pack",
  description: "Roll a non-blank: +1 Mult per distinct inscribed value, up to +4.",
  phase: "onFinal",
  apply: (ctx) => {
    if (!ctx.faces.some((value) => value !== null)) return ctx;
    const distinct = new Set(ctx.dieFaces.flat().filter((value) => value !== null)).size;
    const amount = Math.min(4, distinct);
    if (amount === 0) return ctx;
    return addStep({ ...ctx, mult: ctx.mult + amount }, {
      source: "Variety Pack",
      kind: "mult",
      amount,
      note: `${distinct} distinct, capped at 4`,
    });
  },
};

/** The starter pool, in a stable order. */
export const cardModifiers: readonly Modifier[] = [
  fiver,
  oddball,
  rainbow,
  trips,
  underdog,
  blankCheck,
  dudDividend,
  cleanFinish,
  carbonCopy,
  loneWolf,
  middleChild,
  varietyPack,
];

/** Registry form for `Config.modifiers`. */
export const cardRegistry: ModifierRegistry = Object.fromEntries(
  cardModifiers.map((m) => [m.id, m]),
);
