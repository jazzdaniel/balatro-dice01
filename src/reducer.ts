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
import type { Action, Config, Die, GameState, Match, RewardOffer, RollResult } from "./types.js";

const DICE_STREAM = "dice";
const REWARDS_STREAM = "rewards";

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

/**
 * Draw the round's card offers from the `rewards` stream: a deterministic
 * partial shuffle of the modifiers not yet held, capped at `cards.offerCount`.
 */
function makeCardOffers(
  rng: RngState,
  config: Config,
  acquired: readonly string[],
): { offers: RewardOffer[]; rng: RngState } {
  const held = new Set(acquired);
  const pool = Object.keys(config.modifiers).filter((id) => !held.has(id));
  const count = Math.min(config.cards.offerCount, pool.length);

  let next = rng;
  for (let i = 0; i < count; i++) {
    const draw = drawInt(next, REWARDS_STREAM, pool.length - i);
    next = draw.rng;
    const j = i + draw.value;
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }

  const offers = pool.slice(0, count).map((modId): RewardOffer => {
    const mod = config.modifiers[modId]!;
    return {
      id: `card:${modId}`,
      kind: "card",
      modifierId: modId,
      description: `${mod.name} — ${mod.description}`,
    };
  });
  return { offers, rng: next };
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
        const { offers, rng } = makeCardOffers(state.rng, state.config, state.acquiredModifiers);
        return { ...base, rng, phase: "reward", rewardOffers: offers };
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

    case "nextRound": {
      if (state.phase !== "reward") throw new Error("nextRound is only valid during the reward phase");
      const round = state.round + 1;
      return {
        ...state,
        round,
        targetScore: state.config.targetForRound(round),
        turnsRemaining: state.config.turnsPerRound,
        roundScore: 0,
        phase: "rolling",
        turn: null,
        rewardOffers: [],
      };
    }

    case "chooseReward": {
      if (state.phase !== "reward") {
        throw new Error(`chooseReward is only valid during the reward phase`);
      }
      const offer = state.rewardOffers.find((o) => o.id === action.rewardId);
      if (offer === undefined) throw new Error(`Unknown reward offer: "${action.rewardId}"`);
      if (offer.kind !== "card" || offer.modifierId === undefined) {
        throw new Error(`Reward "${action.rewardId}" is not a card offer`);
      }
      const modId = offer.modifierId;
      if (state.config.modifiers[modId] === undefined) {
        throw new Error(`Unknown modifier: "${modId}"`);
      }
      if (state.acquiredModifiers.includes(modId)) {
        throw new Error(`Card "${modId}" is already held`);
      }

      const acquired = [...state.acquiredModifiers];
      if (acquired.length >= state.config.cards.slots) {
        const { discard } = action;
        if (discard === undefined) {
          throw new Error(`All ${state.config.cards.slots} card slots full — specify a card to discard`);
        }
        const idx = acquired.indexOf(discard);
        if (idx === -1) throw new Error(`Cannot discard "${discard}" — not currently held`);
        acquired.splice(idx, 1);
      }
      acquired.push(modId);
      // Reward taken: clear offers, stay in reward phase until nextRound.
      return { ...state, acquiredModifiers: acquired, rewardOffers: [] };
    }

    case "tradeDie":
      throw new Error(`Action "${action.type}" not implemented yet (trades are a later build step)`);
  }
}

/** Replay a full match to its resulting state. */
export function replay(match: Match): GameState {
  return match.actions.reduce(reduce, createInitialState(match.seed, match.config));
}
