/**
 * Read-side queries. A UI renders from these; the engine never renders itself.
 */

import { scoreTurn } from "./scoring.js";
import type { Action, Die, GameState, ScoreBreakdown } from "./types.js";

export function getDice(state: GameState): readonly Die[] {
  return state.dice;
}

/** The most recently locked-in turn's breakdown, or null if none yet. */
export function getLastScore(state: GameState): ScoreBreakdown | null {
  return state.lastScore;
}

/** Live breakdown for the in-progress turn (before lock-in), or null if no turn. */
export function getScorePreview(state: GameState): ScoreBreakdown | null {
  return state.turn === null ? null : scoreTurn(state);
}

/** The action `type`s currently legal from this state. */
export function getLegalActions(state: GameState): Action["type"][] {
  const legal: Action["type"][] = [];
  if (state.phase === "rolling") {
    if (state.turn === null) {
      legal.push("roll");
    } else {
      legal.push("lockIn");
      if (state.turn.rerollsRemaining > 0) legal.push("reroll");
    }
  }
  if (state.phase === "reward") {
    legal.push("chooseReward", "tradeDie", "nextRound");
  }
  if (state.phase !== "gameOver") legal.push("inscribeFace");
  return legal;
}
