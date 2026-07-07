/**
 * A minimal interactive terminal game on top of the engine — enough to *play*
 * the core loop and get a feel for it. Run with: `npm run play`.
 *
 * What's playable: build your die by inscribing faces, roll / reroll / lock in
 * to score, collect scoring cards between rounds (3 slots — take one past that
 * and you discard forever), and push through rising targets until you die.
 * Not yet in this build: adding dice, trades.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createInitialState, reduce } from "./src/reducer.js";
import { cardRegistry } from "./src/cards.js";
import { getScorePreview } from "./src/selectors.js";
import type { Config, FaceValue, GameState } from "./src/types.js";

/** Forgiving starter config so round 1 is winnable with a single die. */
const playConfig: Config = {
  dice: { startingCount: 1, cap: 3 },
  reroll: { budget: 2 },
  cards: { slots: 3, offerCount: 3 },
  targetForRound: (round) => 5 * round,
  turnsPerRound: 4,
  rngStreams: ["dice", "rewards"],
  modifiers: cardRegistry,
};

const rl = readline.createInterface({ input, output });

async function ask(prompt: string): Promise<string> {
  return (await rl.question(prompt)).trim();
}

/** Prompt for a 1-based menu choice in [1, count]; loops until valid. Returns 0-based. */
async function askIndex(prompt: string, count: number): Promise<number> {
  for (;;) {
    const raw = await ask(prompt);
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= count) return n - 1;
    console.log(`  Please enter a number from 1 to ${count}.`);
  }
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

/** The player's held scoring cards (global run slots). */
function renderCards(state: GameState): string {
  const slots = state.config.cards.slots;
  const held = state.acquiredModifiers;
  if (held.length === 0) return `  cards (0/${slots}): —`;
  const names = held.map((id) => state.config.modifiers[id]?.name ?? id).join(", ");
  return `  cards (${held.length}/${slots}): ${names}`;
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

/** Reward step: pick one offered card. With slots full you MUST discard one — gone forever. */
async function chooseCard(state: GameState): Promise<GameState> {
  const offers = state.rewardOffers;
  if (offers.length === 0) {
    console.log("  No new cards on offer — you hold them all.");
    return state;
  }
  console.log("\n  Pick a card:");
  offers.forEach((o, i) => console.log(`    ${i + 1}) ${o.description}`));
  const offer = offers[await askIndex("  Which card? ", offers.length)]!;

  let discard: string | undefined;
  const slots = state.config.cards.slots;
  if (state.acquiredModifiers.length >= slots) {
    console.log(`\n  Slots full (${slots}/${slots}). Discard one — gone forever:`);
    state.acquiredModifiers.forEach((id, i) => {
      console.log(`    ${i + 1}) ${state.config.modifiers[id]?.name ?? id}`);
    });
    discard = state.acquiredModifiers[await askIndex("  Discard which? ", state.acquiredModifiers.length)];
  }

  const next = reduce(state, { type: "chooseReward", rewardId: offer.id, discard });
  const took = offer.modifierId ? state.config.modifiers[offer.modifierId]?.name : offer.id;
  console.log(`  Took ${took}.${discard ? ` Discarded ${state.config.modifiers[discard]?.name}.` : ""}`);
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
    const bd = getScorePreview(s);
    const detail = bd ? `sum ${bd.sum}${bd.add ? ` +${bd.add}` : ""} × mult ${bd.mult}` : "";
    console.log(`  this roll scores: ${bd?.total ?? 0}${detail ? `  (${detail})` : ""}`);
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
      console.log(renderCards(state));

      if (state.phase === "rolling") {
        state = await playTurn(state);
        if (state.lastScore) {
          console.log(`  → turn scored ${state.lastScore.total}. Round total: ${state.roundScore}/${state.targetScore}.`);
        }
      }

      if (state.phase === "reward") {
        console.log(`\n✅  Round ${state.round} cleared!`);
        console.log("Reward — take a card:");
        state = await chooseCard(state);
        console.log("\nAnd inscribe another face:");
        state = await inscribeOneFace(state);
        state = reduce(state, { type: "nextRound" });
        console.log(`\nOn to round ${state.round} (target ${state.targetScore}).`);
      }

      if (state.phase === "gameOver") {
        console.log(`\n💀  Out of turns on round ${state.round}. You needed ${state.targetScore}, had ${state.roundScore}.`);
        console.log(`You made it to round ${state.round}. Final die:`);
        console.log(renderDie(state, 0));
        console.log(renderCards(state));
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
