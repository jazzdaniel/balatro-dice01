/**
 * Core domain types. Terms follow the glossary in CONTEXT.md — die, face,
 * inscribe, blank/dud, turn, modifier, round, run, trade, match.
 *
 * State is immutable and serializable. Config is typed TS (may hold functions);
 * runtime modifier behaviour lives in a registry keyed by id so state stays
 * plain data.
 */

import type { RngState, StreamName } from "./rng.js";

/** An inscribed face value. Faces are otherwise blank (see `Face`). */
export type FaceValue = 1 | 2 | 3 | 4 | 5 | 6;

/** One side of a die. `value: null` means blank — it rolls as a dud worth 0. */
export interface Face {
  readonly value: FaceValue | null;
}

export type DieId = string;

/** A persistent, identity-bearing die. Faces are data the player inscribes. */
export interface Die {
  readonly id: DieId;
  /** Exactly 6 faces, index 0..5. */
  readonly faces: readonly Face[];
  /** Ids of modifiers attached to this die; resolved via the registry. */
  readonly enchantments: readonly string[];
}

// ── Scoring pipeline ─────────────────────────────────────────────────────────

/** Ordered hook phases. Kept minimal; add only when an experiment needs one. */
export type HookPhase = "onRoll" | "onScore" | "onFinal";

/** One line of the inspectable score breakdown. */
export interface ScoreStep {
  readonly source: string;
  readonly kind: "sum" | "add" | "mult";
  readonly amount: number;
  readonly note: string;
}

/** The mutable-through-the-pipeline scoring context. Modifiers return a new one. */
export interface ScoreContext {
  /** The final shown face value per die this turn; null for a blank (dud). */
  readonly faces: readonly (FaceValue | null)[];
  readonly sum: number;
  readonly add: number;
  readonly mult: number;
  readonly steps: readonly ScoreStep[];
}

/** `(sum + add) * mult`, plus the steps that produced it. */
export interface ScoreBreakdown {
  readonly sum: number;
  readonly add: number;
  readonly mult: number;
  readonly total: number;
  readonly steps: readonly ScoreStep[];
}

/**
 * A data-described scoring effect. `apply` is a pure function of the context;
 * kept in a registry (not in state) so game state remains serializable.
 */
export interface Modifier {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly phase: HookPhase;
  readonly apply: (ctx: ScoreContext) => ScoreContext;
}

export type ModifierRegistry = Readonly<Record<string, Modifier>>;

// ── Turn ─────────────────────────────────────────────────────────────────────

/** Which face each die is currently showing (index into that die's faces). */
export interface RollResult {
  readonly dieId: DieId;
  readonly faceIndex: number;
}

/** In-progress turn state: current roll and how many rerolls remain. */
export interface TurnState {
  readonly roll: readonly RollResult[];
  readonly rerollsRemaining: number;
}

// ── Rewards ──────────────────────────────────────────────────────────────────

export type RewardKind = "inscribe" | "overwrite" | "addDie" | "enchant" | "tradeDie";

/** An offered reward in the between-rounds reward step. */
export interface RewardOffer {
  readonly id: string;
  readonly kind: RewardKind;
  readonly description: string;
}

// ── Config (typed TS; the lab's tuning surface) ──────────────────────────────

export interface Config {
  readonly dice: {
    readonly startingCount: number;
    readonly cap: number;
  };
  readonly reroll: {
    /** Rerolls available per turn, beyond the initial roll. */
    readonly budget: number;
  };
  /** Target score for a given 1-based round number. */
  readonly targetForRound: (round: number) => number;
  /** Turns granted per round. */
  readonly turnsPerRound: number;
  /** All streams to derive from the master seed. */
  readonly rngStreams: readonly StreamName[];
  readonly modifiers: ModifierRegistry;
}

// ── Game state (immutable, serializable) ─────────────────────────────────────

export type GamePhase = "rolling" | "reward" | "gameOver";

export interface GameState {
  readonly config: Config;
  readonly rng: RngState;
  readonly dice: readonly Die[];
  /** 1-based current round. */
  readonly round: number;
  readonly targetScore: number;
  readonly turnsRemaining: number;
  /** Cumulative score toward the current round's target. */
  readonly roundScore: number;
  readonly phase: GamePhase;
  /** Active turn while `phase === "rolling"`, else null. */
  readonly turn: TurnState | null;
  /** Ids of acquired global modifiers; resolved via `config.modifiers`. */
  readonly acquiredModifiers: readonly string[];
  /** Offers presented while `phase === "reward"`. */
  readonly rewardOffers: readonly RewardOffer[];
  /** Breakdown of the most recently locked-in turn. */
  readonly lastScore: ScoreBreakdown | null;
}

// ── Actions (the reducer's input) ────────────────────────────────────────────

export type Action =
  | { readonly type: "roll" }
  | { readonly type: "reroll"; readonly held: readonly DieId[] }
  | { readonly type: "lockIn" }
  | {
      readonly type: "inscribeFace";
      readonly dieId: DieId;
      readonly faceIndex: number;
      readonly value: FaceValue;
    }
  | { readonly type: "chooseReward"; readonly rewardId: string }
  | { readonly type: "tradeDie"; readonly give: DieId; readonly takeRewardId: string }
  | { readonly type: "nextRound" };

/** A fully replayable match. Feed these three in, get identical state out. */
export interface Match {
  readonly seed: string;
  readonly config: Config;
  readonly actions: readonly Action[];
}
