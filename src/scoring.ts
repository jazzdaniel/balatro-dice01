/**
 * The scoring pipeline: base = sum of showing faces (blanks contribute 0),
 * then modifiers move `add`/`mult` across ordered phases, then
 * `total = (sum + add) * mult`. Emits a step-by-step breakdown.
 */

import type {
  GameState,
  HookPhase,
  Modifier,
  ScoreBreakdown,
  ScoreContext,
} from "./types.js";

const PHASE_ORDER: readonly HookPhase[] = ["onRoll", "onScore", "onFinal"];

/** Resolve the modifiers active this turn: global acquisitions + die enchantments. */
function activeModifiers(state: GameState): Modifier[] {
  const ids: string[] = [...state.acquiredModifiers];
  for (const die of state.dice) ids.push(...die.enchantments);

  const resolved: Modifier[] = [];
  for (const id of ids) {
    const mod = state.config.modifiers[id];
    if (mod === undefined) throw new Error(`Unknown modifier id: "${id}"`);
    resolved.push(mod);
  }
  return resolved;
}

/** Score the current (locked-in) turn into an inspectable breakdown. */
export function scoreTurn(state: GameState): ScoreBreakdown {
  const turn = state.turn;
  if (turn === null) throw new Error("scoreTurn called with no active turn");

  const diceById = new Map(state.dice.map((d) => [d.id, d]));
  const faces = turn.roll.map((r) => {
    const die = diceById.get(r.dieId);
    return die?.faces[r.faceIndex]?.value ?? null;
  });
  const dieFaces = turn.roll.map((r) => {
    const die = diceById.get(r.dieId);
    return die ? die.faces.map((f) => f.value) : [];
  });

  const sum = faces.reduce<number>((acc, v) => acc + (v ?? 0), 0);

  let ctx: ScoreContext = {
    faces,
    dieFaces,
    sum,
    add: 0,
    mult: 1,
    steps: [{ source: "base", kind: "sum", amount: sum, note: "sum of showing faces" }],
  };

  const mods = activeModifiers(state);
  for (const phase of PHASE_ORDER) {
    for (const mod of mods) {
      if (mod.phase === phase) ctx = mod.apply(ctx);
    }
  }

  return {
    sum: ctx.sum,
    add: ctx.add,
    mult: ctx.mult,
    total: (ctx.sum + ctx.add) * ctx.mult,
    steps: ctx.steps,
  };
}
