/**
 * The pure reducer: `(state, action) => newState`. No hidden mutation, no
 * callbacks. A match replays from `{ seed, config, actions }`.
 *
 * Implemented: roll, reroll, lockIn, inscribeFace. The reward economy
 * (chooseReward, tradeDie) is stubbed — that's the next build step.
 */

import { createRng, drawInt } from "./rng.js";
import type { RngState } from "./rng.js";
import { scoreTurn } from "./scoring.js";
import type { Action, Config, Die, GameState, Match, RollResult } from "./types.js";

const DICE_STREAM = "dice";

function blankDie(id: string): Die {
  return {
    id,
    faces: Array.from({ length: 6 }, () => ({ value: null })),
    enchantments: [],
  };
}

/** Build the initial state for a fresh run. */
export function createInitialState(seed: string, config: Config): GameState {
  const dice = Array.from({ length: config.dice.startingCount }, (_, i) => blankDie(`die-${i}`));
  return {
    config,
    rng: createRng(seed, config.rngStreams),
    dice,
    round: 1,
    targetScore: config.targetForRound(1),
    turnsRemaining: config.turnsPerRound,
    roundScore: 0,
    phase: "rolling",
    turn: null,
    acquiredModifiers: [],
    rewardOffers: [],
    lastScore: null,
  };
}

/** Roll the given dice from the `dice` stream, threading RNG state. */
function rollDice(rng: RngState, dice: readonly Die[]): { roll: RollResult[]; rng: RngState } {
  let next = rng;
  const roll: RollResult[] = [];
  for (const die of dice) {
    const drawn = drawInt(next, DICE_STREAM, 6);
    next = drawn.rng;
    roll.push({ dieId: die.id, faceIndex: drawn.value });
  }
  return { roll, rng: next };
}

export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "roll": {
      if (state.phase !== "rolling") throw new Error(`Cannot roll during phase "${state.phase}"`);
      if (state.turn !== null) throw new Error("Cannot roll: a turn is already in progress");
      const { roll, rng } = rollDice(state.rng, state.dice);
      return { ...state, rng, turn: { roll, rerollsRemaining: state.config.reroll.budget } };
    }

    case "reroll": {
      const turn = state.turn;
      if (turn === null) throw new Error("Cannot reroll: no turn in progress");
      if (turn.rerollsRemaining <= 0) throw new Error("No rerolls remaining");
      const held = new Set(action.held);
      const toReroll = state.dice.filter((d) => !held.has(d.id));
      const { roll: newRolls, rng } = rollDice(state.rng, toReroll);
      const byDie = new Map(newRolls.map((r) => [r.dieId, r]));
      const roll = turn.roll.map((r) => byDie.get(r.dieId) ?? r);
      return {
        ...state,
        rng,
        turn: { roll, rerollsRemaining: turn.rerollsRemaining - 1 },
      };
    }

    case "lockIn": {
      if (state.turn === null) throw new Error("Cannot lock in: no turn in progress");
      const breakdown = scoreTurn(state);
      const roundScore = state.roundScore + breakdown.total;
      const turnsRemaining = state.turnsRemaining - 1;
      const base: GameState = {
        ...state,
        roundScore,
        turnsRemaining,
        turn: null,
        lastScore: breakdown,
      };
      if (roundScore >= state.targetScore) {
        // TODO: populate rewardOffers from a reward pool once the economy lands.
        return { ...base, phase: "reward", rewardOffers: [] };
      }
      if (turnsRemaining <= 0) {
        return { ...base, phase: "gameOver" };
      }
      return base; // stay in "rolling", ready for the next turn
    }

    case "inscribeFace": {
      if (state.phase === "gameOver") throw new Error("Cannot inscribe: game over");
      if (action.faceIndex < 0 || action.faceIndex > 5) {
        throw new Error(`faceIndex out of range: ${action.faceIndex}`);
      }
      let found = false;
      const dice = state.dice.map((die) => {
        if (die.id !== action.dieId) return die;
        found = true;
        const faces = die.faces.map((face, i) =>
          i === action.faceIndex ? { value: action.value } : face,
        );
        return { ...die, faces };
      });
      if (!found) throw new Error(`Unknown die: "${action.dieId}"`);
      return { ...state, dice };
    }

    case "chooseReward":
    case "tradeDie":
      throw new Error(`Action "${action.type}" not implemented yet (reward economy is the next build step)`);
  }
}

/** Replay a full match to its resulting state. */
export function replay(match: Match): GameState {
  return match.actions.reduce(reduce, createInitialState(match.seed, match.config));
}
