/**
 * A minimal interactive terminal game on top of the engine — enough to *play*
 * the core loop and get a feel for it. Run with: `npm run play`.
 *
 * What's playable: build your die by inscribing faces, roll / reroll / lock in
 * to score, and clear escalating rounds until you run out of turns.
 * Not yet in this build: adding dice, trades, and scoring modifiers.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createInitialState, reduce } from "./src/reducer.js";
import { getScorePreview } from "./src/selectors.js";
import type { Config, FaceValue, GameState } from "./src/types.js";

const WIN_ROUND = 8;

/** Forgiving starter config so round 1 is winnable with a single die. */
const playConfig: Config = {
  dice: { startingCount: 1, cap: 3 },
  reroll: { budget: 2 },
  targetForRound: (round) => 5 * round,
  turnsPerRound: 4,
  rngStreams: ["dice", "rewards"],
  modifiers: {},
};

const rl = readline.createInterface({ input, output });

async function ask(prompt: string): Promise<string> {
  return (await rl.question(prompt)).trim();
}

/** A face's value as a display glyph; blank (dud) shows as "·". */
function faceGlyph(value: FaceValue | null): string {
  return value === null ? "·" : String(value);
}

function renderDie(state: GameState, dieIndex: number): string {
  const die = state.dice[dieIndex];
  if (!die) return "";
  const faces = die.faces.map((f) => `[${faceGlyph(f.value)}]`).join("");
  return `  die ${dieIndex + 1}: ${faces}`;
}

function renderAllDice(state: GameState): string {
  return state.dice.map((_, i) => renderDie(state, i)).join("\n");
}

/** Show what each die is currently rolling this turn. */
function renderRoll(state: GameState): string {
  if (state.turn === null) return "";
  return state.turn.roll
    .map((r, i) => {
      const die = state.dice.find((d) => d.id === r.dieId);
      const shown = die?.faces[r.faceIndex]?.value ?? null;
      return `  die ${i + 1} shows ${faceGlyph(shown)}`;
    })
    .join("\n");
}

function header(state: GameState): string {
  return `\n── Round ${state.round}  |  target ${state.targetScore}  |  score ${state.roundScore}  |  turns left ${state.turnsRemaining} ──`;
}

/** Prompt for a face value 1–6, looping until valid. */
async function askFaceValue(): Promise<FaceValue> {
  for (;;) {
    const raw = await ask("  Inscribe which value on a face? (1-6): ");
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 6) return n as FaceValue;
    console.log("  Please enter a whole number from 1 to 6.");
  }
}

/** Reward / setup: inscribe one face on die 1. Fills a blank if there is one. */
async function inscribeOneFace(state: GameState): Promise<GameState> {
  console.log(renderDie(state, 0));
  const die = state.dice[0];
  if (!die) return state;
  const value = await askFaceValue();
  const blankIndex = die.faces.findIndex((f) => f.value === null);
  let faceIndex = blankIndex;
  if (blankIndex === -1) {
    // No blanks left — overwrite a face of the player's choosing.
    for (;;) {
      const raw = await ask("  Die is full — overwrite which face? (1-6): ");
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 1 && n <= 6) {
        faceIndex = n - 1;
        break;
      }
      console.log("  Please enter a whole number from 1 to 6.");
    }
  }
  const next = reduce(state, { type: "inscribeFace", dieId: die.id, faceIndex, value });
  console.log(`  Inscribed ${value} on face ${faceIndex + 1}.`);
  console.log(renderDie(next, 0));
  return next;
}

/** Ask which dice to HOLD when rerolling; returns their ids. */
async function askHeld(state: GameState): Promise<string[]> {
  if (state.dice.length === 1) return []; // nothing to hold with one die
  const raw = await ask("  Dice to HOLD (e.g. '1 3', blank = reroll all): ");
  const ids: string[] = [];
  for (const token of raw.split(/[\s,]+/).filter(Boolean)) {
    const n = Number(token);
    const die = state.dice[n - 1];
    if (die) ids.push(die.id);
  }
  return ids;
}

async function playTurn(state: GameState): Promise<GameState> {
  // Start of turn: roll (or quit).
  const go = await ask("Press Enter to roll ('q' to quit): ");
  if (go.toLowerCase() === "q") throw new Error("__quit__");
  let s = reduce(state, { type: "roll" });

  // Roll → reroll loop → lock in.
  for (;;) {
    console.log(renderRoll(s));
    const preview = getScorePreview(s)?.total ?? 0;
    console.log(`  this roll scores: ${preview}`);
    const rerolls = s.turn?.rerollsRemaining ?? 0;

    if (rerolls <= 0) {
      console.log("  No rerolls left — locking in.");
      return reduce(s, { type: "lockIn" });
    }

    const choice = await ask(`  [l]ock in, or [r]eroll (${rerolls} left)? `);
    if (choice.toLowerCase() === "r") {
      const held = await askHeld(s);
      s = reduce(s, { type: "reroll", held });
    } else {
      return reduce(s, { type: "lockIn" });
    }
  }
}

async function main(): Promise<void> {
  console.log("🎲  ROGUELIKE DICE — build your die, clear the rounds.\n");
  const seed = (await ask("Seed (blank for 'daily'): ")) || "daily";
  let state = createInitialState(seed, playConfig);

  console.log("\nYour die starts blank. Inscribe your first face:");
  state = await inscribeOneFace(state);

  try {
    for (;;) {
      console.log(header(state));
      console.log(renderAllDice(state));

      if (state.phase === "rolling") {
        state = await playTurn(state);
        if (state.lastScore) {
          console.log(`  → turn scored ${state.lastScore.total}. Round total: ${state.roundScore}/${state.targetScore}.`);
        }
      }

      if (state.phase === "reward") {
        console.log(`\n✅  Round ${state.round} cleared!`);
        if (state.round >= WIN_ROUND) {
          console.log(`\n🏆  You cleared round ${WIN_ROUND}. You win! Final die:`);
          console.log(renderDie(state, 0));
          break;
        }
        console.log("Reward — inscribe another face:");
        state = await inscribeOneFace(state);
        state = reduce(state, { type: "nextRound" });
        console.log(`\nOn to round ${state.round} (target ${state.targetScore}).`);
      }

      if (state.phase === "gameOver") {
        console.log(`\n💀  Out of turns on round ${state.round}. You needed ${state.targetScore}, had ${state.roundScore}.`);
        console.log("Final die:");
        console.log(renderDie(state, 0));
        break;
      }
    }
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "__quit__") throw err;
    console.log("\nQuit. Thanks for playing!");
  } finally {
    rl.close();
  }
}

void main();
