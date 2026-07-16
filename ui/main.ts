/**
 * Playable UI for the roguelike-dice engine (`npm run play-ui`). It is a thin
 * consumer: it dispatches engine actions and renders from state + selectors —
 * no game rules live here. Layout follows the "POLYHEDRAL" Figma screen; the
 * Balatro-style chrome that has no engine backing (money, deck, ante/blind) is
 * cosmetic flavor, labelled as such.
 *
 * Engine → UI mapping: Chips = sum + add · Mult = mult · Current/Target Score =
 * roundScore/targetScore · Rolls Left = turnsRemaining · Rerolls = turn.rerolls.
 */

import { createInitialState, reduce } from "../src/reducer.js";
import { getScorePreview } from "../src/selectors.js";
import { cardRegistry } from "../src/cards.js";
import type { Action, Config, Die, FaceValue, GameState } from "../src/types.js";

const config: Config = {
  dice: { startingCount: 1, cap: 3 },
  reroll: { budget: 2 },
  cards: { slots: 3, offerCount: 3 },
  targetForRound: (round) => 6 * round, // round 1 = 6, then +6 per round
  turnsPerRound: 4,
  rngStreams: ["dice", "rewards"],
  modifiers: cardRegistry,
};

function freshSeed(): string {
  return `run-${Date.now()}`;
}

// ── State (engine state + a little transient UI state) ───────────────────────
let state: GameState = createInitialState(freshSeed(), config);
let inscribing: { dieId: string; faceIndex: number } | null = null;
let pendingDiscardOffer: string | null = null;
/** Set when the player declines this round's card, so the offers step is done
 *  without acquiring one. Taking a card empties the offers instead. */
let cardSkipped = false;
/** Set when the player declines to inscribe a face, so the face step is done
 *  without spending the pending inscribe. */
let faceSkipped = false;
/** Has the run begun? Before this, the player inscribes their one starting face. */
let started = false;
/**
 * Faces the player may inscribe right now. Inscribing is gated: 1 at setup, +1
 * each time a round finishes (granted on entry to the reward phase). It is 0
 * during a round, so faces are only ever added between rounds.
 */
let pendingInscribes = 1;

const app = document.getElementById("app")!;

function dispatch(action: Action): void {
  const before = state.phase;
  try {
    state = reduce(state, action);
  } catch (err) {
    console.warn("action rejected:", action, err);
  }
  // Finishing a round grants one face to inscribe in the reward step, and a
  // fresh card choice the player may take or skip.
  if (state.phase === "reward" && before !== "reward") {
    pendingInscribes = 1;
    cardSkipped = false;
    faceSkipped = false;
  }
  render();
}

// ── Big-die roll animation ────────────────────────────────────────────────────
// The primary dice animate after dispatch, purely cosmetically, over the
// already-rendered final result. Each variant is a self-contained function with
// the signature (dice) => void; whichever is active is chosen by `activeAnim`
// and can be swapped live via the on-screen toggle (data-act="cycle-anim").
//
// Contract every variant honours: it may mutate .bigdie / .bigdie-face freely,
// but must end with each die showing renderPips(data-value) — the engine has
// already committed the result; the animation is decoration over it. No cleanup
// is needed because the next render() rebuilds the whole board from scratch.
type RollAnimation = (dice: HTMLElement[], onComplete: () => void) => void;
let rollTimer: ReturnType<typeof setInterval> | null = null;
let rollResultsPending = false;
let previousRollState: GameState | null = null;
let scoreTimer: ReturnType<typeof setInterval> | null = null;
let handCountTimer: ReturnType<typeof setInterval> | null = null;
let targetCountTimer: ReturnType<typeof setInterval> | null = null;
let scoreSequencePending = false;
let celebrateRoundWin = false;
let celebrationTimer: ReturnType<typeof setTimeout> | null = null;

// Variant "pip-flicker": the original. Dice flicker through random faces (with a
// shake) for a short spell, then settle on the committed value.
function pipFlickerRoll(dice: HTMLElement[], onComplete: () => void): void {
  dice.forEach((d) => d.classList.add("rolling"));
  const step = 70;
  const duration = 640;
  let elapsed = 0;
  rollTimer = setInterval(() => {
    elapsed += step;
    for (const d of dice) {
      // Flash a random one of this die's own faces (blanks included).
      const faces = (d.dataset.faces ?? "").split(",");
      const pick = faces[Math.floor(Math.random() * faces.length)];
      const face = d.querySelector(".bigdie-face");
      if (face) face.innerHTML = renderPips(pick ? Number(pick) : null);
    }
    if (elapsed >= duration) {
      clearInterval(rollTimer!);
      rollTimer = null;
      for (const d of dice) {
        const raw = d.dataset.value;
        const value = raw ? Number(raw) : null;
        d.classList.remove("rolling");
        d.classList.add("settle");
        const face = d.querySelector(".bigdie-face");
        if (face) face.innerHTML = renderPips(value);
        setTimeout(() => d.classList.remove("settle"), 240);
      }
      onComplete();
    }
  }, step);
}

// The cube's six sides, in die face-index order (0..5). This is the physical
// layout the CSS positions; the rolled index selects which one faces us at rest.
const CUBE_SIDES = ["cf-front", "cf-back", "cf-right", "cf-left", "cf-top", "cf-bottom"];
// Rotation that brings each side to face the camera — the inverse of the CSS
// transform that placed it. Index-aligned with CUBE_SIDES. A slight resting tilt
// is layered on in CSS so the settled die still reads as 3D, not flat.
const SIDE_TO_FRONT = [
  "rotateY(0deg)", // front
  "rotateY(-180deg)", // back
  "rotateY(-90deg)", // right
  "rotateY(90deg)", // left
  "rotateX(-90deg)", // top
  "rotateX(90deg)", // bottom
];

/** Parse "5,,3,,," → [5, null, 3, null, null, null] (blanks are empty entries). */
function parseFaces(raw: string): (number | null)[] {
  const vals = raw.split(",").map((s) => (s === "" ? null : Number(s)));
  return Array.from({ length: 6 }, (_, i) => vals[i] ?? null);
}

// The six sides of a die's cube: each shows that face's actual inscribed value
// (or blank), so the cube is a faithful 3D copy of the die.
function cubeSidesHTML(faces: (number | null)[]): string {
  return CUBE_SIDES.map(
    (cls, i) => `<div class="cube-face ${cls}">${renderPips(faces[i] ?? null)}</div>`,
  ).join("");
}

/** A cube already at rest, showing side `rolled` (default front) toward camera.
 *  Used by the static render so the pre-/post-roll die matches the rolling one. */
function cubeSettledMarkup(faces: (number | null)[], rolled: number): string {
  const front = SIDE_TO_FRONT[rolled] ?? SIDE_TO_FRONT[0]!;
  return `<div class="dice-cube settled" style="--face-to-front:${front}">${cubeSidesHTML(faces)}</div>`;
}

/** A cube in its tumbling state, for the roll animation to spin. */
function cubeMarkup(faces: (number | null)[]): string {
  return `<div class="dice-cube rolling">${cubeSidesHTML(faces)}</div>`;
}

// Variant "cube-3d": a real CSS 3D cube — a faithful copy of the die, each side
// carrying that face's real value (or blankness) — tumbles through space, then
// settles by rotating the face that actually landed toward the camera.
// (Adapted from the React FACE_TRANSFORMS prototype.)
function cube3dRoll(dice: HTMLElement[], onComplete: () => void): void {
  const duration = 950;
  for (const d of dice) {
    const faceEl = d.querySelector<HTMLElement>(".bigdie-face");
    if (!faceEl) continue;
    // Hide the flat die's own background/bevel so only the 3D cube is visible.
    d.classList.add("cube-active");
    faceEl.classList.add("cube-mode");
    faceEl.innerHTML = cubeMarkup(parseFaces(d.dataset.faces ?? ""));
  }
  rollTimer = setTimeout(() => {
    for (const d of dice) {
      const cube = d.querySelector<HTMLElement>(".dice-cube");
      if (!cube) continue;
      const rolled = d.dataset.rolled ? Number(d.dataset.rolled) : 0;
      const front = SIDE_TO_FRONT[rolled] ?? SIDE_TO_FRONT[0]!;
      // Freeze the exact final tumble pose before removing its animation. On
      // the next frame, ease from that pose into the landed face so there is no
      // one-frame snap between rolling and resting.
      cube.style.animation = "none";
      cube.style.transform = "translateZ(calc(var(--half) * -1)) rotateX(720deg) rotateY(900deg)";
      cube.classList.remove("rolling");
      cube.classList.add("landing");
      void cube.offsetWidth;
      requestAnimationFrame(() => {
        cube.style.transform = `translateZ(calc(var(--half) * -1)) rotateX(-14deg) rotateY(16deg) ${front}`;
      });
    }
    rollTimer = window.setTimeout(() => {
      rollTimer = null;
      for (const d of dice) {
        const cube = d.querySelector<HTMLElement>(".dice-cube");
        if (!cube) continue;
        const rolled = d.dataset.rolled ? Number(d.dataset.rolled) : 0;
        cube.style.setProperty("--face-to-front", SIDE_TO_FRONT[rolled] ?? SIDE_TO_FRONT[0]!);
        cube.classList.remove("landing");
        cube.classList.add("settled");
        cube.style.removeProperty("animation");
        cube.style.removeProperty("transform");
      }
      onComplete();
    }, 520);
  }, duration);
}

const ROLL_ANIMATIONS: Record<string, RollAnimation> = {
  "pip-flicker": pipFlickerRoll,
  "cube-3d": cube3dRoll,
};
const ANIM_NAMES = Object.keys(ROLL_ANIMATIONS);
const DEFAULT_ANIM = ANIM_NAMES[0] ?? "pip-flicker";
const savedAnim = localStorage.getItem("rollAnim");
let activeAnim: string = savedAnim && ROLL_ANIMATIONS[savedAnim] ? savedAnim : DEFAULT_ANIM;

function revealRollResults(): void {
  rollResultsPending = false;
  const game = document.querySelector(".game");
  game?.classList.remove("roll-results-pending");
  game?.classList.add("roll-results-revealing");
  countUpHandPreview();
  window.setTimeout(() => {
    previousRollState = null;
  }, 280);
}

/** Count the newly rolled hand up from zero, accelerating for larger totals. */
function countUpHandPreview(): void {
  const handScore = state.turn ? getScorePreview(state).total : 0;
  const handEl = document.querySelector<HTMLElement>(".roll-result-new .hand");
  if (!handEl || !handEl.firstChild) return;
  if (handScore <= 0) {
    handEl.classList.add("sad-zero");
    handEl.addEventListener("animationend", () => handEl.classList.remove("sad-zero"), { once: true });
    return;
  }

  if (handCountTimer !== null) clearInterval(handCountTimer);
  let shown = 0;
  handEl.firstChild.textContent = "0";
  handEl.classList.add("counting");

  // Single-digit hands linger on every point. The interval curves down as the
  // total grows, so large hands still count every integer without dragging.
  const tickMs = Math.max(12, Math.min(120, Math.round(120 / Math.sqrt(Math.max(1, handScore / 9)))));
  handCountTimer = window.setInterval(() => {
    shown += 1;
    handEl.firstChild!.textContent = fmt(shown);
    if (shown >= handScore) {
      clearInterval(handCountTimer!);
      handCountTimer = null;
      handEl.classList.remove("counting");
    }
  }, tickMs);
}

function playRollAnimation(revealResults = false): void {
  if (rollTimer !== null) clearInterval(rollTimer);
  rollTimer = null;
  const dice = Array.from(document.querySelectorAll<HTMLElement>(".bigdie"));
  if (dice.length === 0) {
    if (revealResults) revealRollResults();
    return;
  }
  (ROLL_ANIMATIONS[activeAnim] ?? ROLL_ANIMATIONS[DEFAULT_ANIM]!)(
    dice,
    revealResults ? revealRollResults : () => {},
  );
}

/** Move a scored hand into the round total one point at a time. */
function finishScoreSequence(): void {
  if (!scoreSequencePending) return;
  if (celebrateRoundWin) {
    document.querySelector(".game")?.classList.add("win-celebrating");
    celebrationTimer = window.setTimeout(() => {
      celebrationTimer = null;
      scoreSequencePending = false;
      celebrateRoundWin = false;
      render();
    }, 1500);
  } else {
    scoreSequencePending = false;
    render();
  }
}

function animateNewTurnRolls(previous: number, next: number): void {
  const field = document.querySelector<HTMLElement>(".rolls-left");
  const label = field?.querySelector<HTMLElement>(".stat-label");
  if (!field || !label) return;

  field.classList.add("shake");
  window.setTimeout(() => {
    field.classList.remove("shake");
    field.classList.add("new-turn");
    field.querySelector<HTMLElement>(".pip-dot.spent")?.classList.add("just-spent");
    label.textContent = `ROLLS LEFT ${previous}/${config.turnsPerRound}`;
    label.classList.add("counter-changing");
    window.setTimeout(() => {
      label.textContent = `ROLLS LEFT ${next}/${config.turnsPerRound}`;
    }, 600);
    window.setTimeout(() => {
      field.classList.remove("new-turn");
      label.classList.remove("counter-changing");
    }, 1250);
  }, 340);
}

function countUpTargetScore(): void {
  const target = state.targetScore;
  const targetEl = document.querySelector<HTMLElement>(".target-num");
  if (!targetEl || target <= 0) return;
  if (targetCountTimer !== null) clearInterval(targetCountTimer);

  let shown = 0;
  targetEl.textContent = "0";
  targetEl.classList.add("counting");
  const tickMs = Math.max(12, Math.min(100, Math.round(100 / Math.sqrt(Math.max(1, target / 8)))));
  targetCountTimer = window.setInterval(() => {
    shown += 1;
    targetEl.textContent = fmt(shown);
    if (shown >= target) {
      clearInterval(targetCountTimer!);
      targetCountTimer = null;
      targetEl.classList.remove("counting");
    }
  }, tickMs);
}

function scoreHand(): void {
  if (!state.turn) return;
  if (handCountTimer !== null) clearInterval(handCountTimer);
  handCountTimer = null;
  const startingScore = state.roundScore;
  const startingRolls = state.turnsRemaining;
  const preview = getScorePreview(state);
  const handScore = preview.total;
  const influencingCards = new Set(
    state.acquiredModifiers.filter((id) =>
      preview.steps.some((step) => step.source === cardName(id) && step.amount !== 0),
    ),
  );
  const reachesTarget = startingScore + handScore >= state.targetScore;
  scoreSequencePending = reachesTarget || state.turnsRemaining <= 1;
  celebrateRoundWin = reachesTarget;
  dispatch({ type: "lockIn" });
  if (state.phase === "rolling") animateNewTurnRolls(startingRolls, state.turnsRemaining);

  document.querySelectorAll<HTMLElement>(".mod[data-mod]").forEach((card, i) => {
    if (!influencingCards.has(card.dataset.mod ?? "")) return;
    card.style.setProperty("--card-trigger-delay", `${i * 70}ms`);
    card.classList.add("triggered");
    card.addEventListener("animationend", () => card.classList.remove("triggered"), { once: true });
  });

  const currentEl = document.querySelector<HTMLElement>(".current-num");
  const handEl = document.querySelector<HTMLElement>(".hand");
  if (!currentEl || !handEl || handScore <= 0) {
    finishScoreSequence();
    return;
  }

  if (scoreTimer !== null) clearInterval(scoreTimer);
  let transferred = 0;
  currentEl.textContent = fmt(startingScore);
  if (handEl.firstChild) handEl.firstChild.textContent = fmt(handScore);
  currentEl.classList.add("counting");
  handEl.classList.add("counting");

  // Small hands count deliberately; large hands accelerate without skipping
  // any displayed integer.
  const tickMs = Math.max(16, Math.min(65, Math.floor(1600 / handScore)));
  scoreTimer = window.setInterval(() => {
    transferred += 1;
    currentEl.textContent = fmt(startingScore + transferred);
    if (handEl.firstChild) handEl.firstChild.textContent = fmt(handScore - transferred);
    if (transferred >= handScore) {
      clearInterval(scoreTimer!);
      scoreTimer = null;
      currentEl.classList.remove("counting");
      handEl.classList.remove("counting");
      finishScoreSequence();
    }
  }, tickMs);
}

// ── Small helpers ────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString("en-US");
/** A small keyboard-shortcut hint chip appended inside a button label. */
const kbd = (key: string) => `<kbd class="kbd">${key}</kbd>`;
/** Keys that pick the 1st / 2nd / 3rd offered reward card. */
const OFFER_KEYS = ["A", "S", "D"];

/** Spend one pending inscribe on a specific face. Shared by click and keyboard. */
function applyInscribe(dieId: string, faceIndex: number, value: FaceValue): void {
  inscribing = null;
  pendingInscribes = Math.max(0, pendingInscribes - 1);
  dispatch({ type: "inscribeFace", dieId, faceIndex, value });
}

/** The face a bare number key should stamp: the first blank one, else the very
 *  first face (overwriting is allowed). Null only if there are no dice. */
function nextInscribeTarget(): { dieId: string; faceIndex: number } | null {
  for (const die of state.dice) {
    const i = die.faces.findIndex((f) => f.value === null);
    if (i !== -1) return { dieId: die.id, faceIndex: i };
  }
  const first = state.dice[0];
  return first ? { dieId: first.id, faceIndex: 0 } : null;
}
const cardName = (id: string) => config.modifiers[id]?.name ?? id;
const cardDesc = (id: string) => config.modifiers[id]?.description ?? "";

// ── Render pieces ─────────────────────────────────────────────────────────────
function renderModSlots(): string {
  const slots = config.cards.slots;
  const cells: string[] = [];
  for (let i = 0; i < slots; i++) {
    const id = state.acquiredModifiers[i];
    if (id === undefined) {
      cells.push(`<div class="mod empty"><span>EMPTY SLOT</span></div>`);
    } else {
      cells.push(`
        <div class="mod" data-mod="${id}">
          <div class="mod-badge">MOD</div>
          <div class="mod-name">${cardName(id)}</div>
          <div class="mod-desc">${cardDesc(id)}</div>
        </div>`);
    }
  }
  return cells.join("");
}

/** The board die — display only. Faces are inscribed between rounds, not here. */
function renderDie(die: Die, dieIdx: number, viewState: GameState = state): string {
  const rolledFace = viewState.turn?.roll.find((r) => r.dieId === die.id)?.faceIndex ?? null;
  const tiles = die.faces
    .map((f, i) => {
      const blank = f.value === null;
      const rolled = i === rolledFace;
      return `
        <div class="face${rolled ? " rolled" : ""}${blank ? " blank" : ""}">
          <span class="pip">${blank ? "" : f.value}</span>
          ${rolled ? `<span class="rolled-tag">ROLLED</span>` : ""}
        </div>`;
    })
    .join("");
  return `
    <div class="die">
      <div class="die-label">DIE ${dieIdx + 1}</div>
      <div class="faces">${tiles}</div>
    </div>`;
}

// Classic dice pip layouts, as filled cells of a 3×3 grid (row-major, 0–8).
const PIP_MAP: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Pips for a die face as a 3×3 grid. A blank/null face renders no dots. */
function renderPips(value: number | null): string {
  const on = value != null && PIP_MAP[value] ? PIP_MAP[value] : [];
  const cells = Array.from({ length: 9 }, (_, i) =>
    `<span class="pip-cell">${on.includes(i) ? `<span class="bigpip"></span>` : ""}</span>`,
  ).join("");
  return `<div class="pip-grid">${cells}</div>`;
}

/**
 * The primary die: a large pixel-art die showing the value currently rolled on
 * it. Clickable to roll (before a turn) or reroll (during one, while rerolls
 * remain); disabled otherwise. The roll animation is layered on afterwards by
 * playRollAnimation, which reads the settled value back from data-value.
 */
function renderBigDie(die: Die, idx: number): string {
  const rolledFace = state.turn?.roll.find((r) => r.dieId === die.id)?.faceIndex ?? null;
  const value = rolledFace != null ? die.faces[rolledFace].value : null;
  const midTurn = state.turn !== null;
  const rerolls = state.turn?.rerollsRemaining ?? 0;
  const act = !midTurn ? "roll" : rerolls > 0 ? "reroll" : "";
  const attrs = act ? `data-act="${act}"` : "disabled";
  // In cube-3d mode the resting die is itself a 3D cube, so the pre-roll ("click
  // to roll") and between-roll states match the tumbling animation. The flat pip
  // face is used for every other variant.
  const cube = activeAnim === "cube-3d";
  const cls = `bigdie${value == null ? " blank" : ""}${!midTurn ? " pristine" : ""}${cube ? " cube-active" : ""}`;
  // The roll animation tumbles through this die's own faces, so blanks are
  // encoded as empty entries (e.g. "4,,,,," is one inscribed 4 and five blanks).
  // data-rolled is the index (0..5) of the face that landed, so the cube-3d
  // variant can rotate that exact physical face toward the camera on settle.
  const faces = die.faces.map((f) => f.value ?? "").join(",");
  const faceVals = die.faces.map((f) => f.value ?? null);
  const faceInner = cube
    ? cubeSettledMarkup(faceVals, rolledFace ?? 0)
    : renderPips(value);
  return `
    <button class="${cls}" ${attrs} data-value="${value ?? ""}" data-faces="${faces}" data-rolled="${rolledFace ?? ""}" aria-label="Die ${idx + 1}">
      <div class="bigdie-face${cube ? " cube-mode" : ""}">${faceInner}</div>
    </button>`;
}

/** Primary dice area with a reference-style hint / rolled readout below. */
function renderBigDice(): string {
  const dice = state.dice.map((d, i) => renderBigDie(d, i)).join("");
  const caption = state.turn === null ? "CLICK DICE TO ROLL" : "REROLL OR SCORE THE HAND";
  return `
    <section class="bigdice-area">
      <div class="bigdice">${dice}</div>
      <div class="bigdice-caption">${caption}</div>
    </section>`;
}

/** Clickable die faces used inside the setup / reward modals for inscribing. */
function renderInscribeRow(): string {
  const spent = pendingInscribes <= 0;
  // Once the face step is resolved — a face was added or the player skipped it —
  // just report the outcome; there's nothing left to interact with.
  if (spent || faceSkipped) {
    return `<div class="inscribe-section"><p class="muted">${
      faceSkipped ? "Skipped — no face added." : "✓ Face added."
    }</p></div>`;
  }
  const dice = state.dice
    .map((die, dieIdx) => {
      const tiles = die.faces
        .map((f, i) => {
          const blank = f.value === null;
          return `
            <button class="face small${blank ? " blank" : ""}"
                    data-act="face" data-die="${die.id}" data-face="${i}">
              <span class="pip">${blank ? "" : f.value}</span>
            </button>`;
        })
        .join("");
      return `<div class="die"><div class="die-label">DIE ${dieIdx + 1}</div><div class="faces">${tiles}</div></div>`;
    })
    .join("");
  const note = `<p class="muted">Press ${kbd("1")}–${kbd("6")} to stamp the next face, or click a face to choose where (${pendingInscribes} to add). Overwriting is allowed.</p>`;
  const skip = `<button class="btn skip" data-act="skip-face">Skip — no face ${kbd("Z")}</button>`;
  return `<div class="inscribe-section">${note}${dice}${skip}</div>`;
}

/**
 * A depleting resource shown as a row of pips: `remaining` live (glowing) pips
 * out of `total`, the rest spent (red). The box escalates to a "warn" then a
 * "danger" state as it runs low, making the risk visible. Shared by rolls-left
 * and rerolls so both resources read the same way.
 */
function renderPipStat(
  label: string,
  total: number,
  remaining: number,
  extraClass: string,
  warnAt: number,
  dangerAt: number,
): string {
  const danger = remaining <= dangerAt;
  const warn = !danger && remaining <= warnAt;
  const pips = Array.from({ length: total }, (_, i) =>
    `<span class="pip-dot ${i < remaining ? "live" : "spent"}"></span>`,
  ).join("");
  return `
    <div class="stat pips ${extraClass}${danger ? " danger" : ""}${warn ? " warn" : ""}">
      <div class="pip-row">${pips}</div>
      <div class="stat-label">${label} ${remaining}/${total}</div>
    </div>`;
}

// Rolls left: last roll of the round is the danger moment (danger at 1, warn at 2).
function renderRollsLeft(): string {
  return renderPipStat("ROLLS LEFT", config.turnsPerRound, state.turnsRemaining, "rolls-left", 2, 1);
}

// Rerolls: full between turns; spending them all this turn is the danger (danger at 0, warn at 1).
function renderRerolls(): string {
  const budget = config.reroll.budget;
  const remaining = state.turn ? state.turn.rerollsRemaining : budget;
  return renderPipStat("REROLLS", budget, remaining, "rerolls", 1, 0);
}

function renderStatBar(): string {
  return `
    <header class="statbar">
      <div class="stat">
        <div class="stat-num">${state.round}</div>
        <div class="stat-label">ROUND</div>
      </div>
      ${renderRollsLeft()}
      ${renderRerolls()}
    </header>`;
}

function renderActions(): string {
  const midTurn = state.turn !== null;
  const rerolls = state.turn?.rerollsRemaining ?? 0;
  // Score Hand is always its own button; Roll and Reroll always share the other
  // button (same slot, same style) — "Roll Dice" to start a turn, "Reroll" during it.
  const score = `<button class="btn score" data-act="lockin" ${midTurn ? "" : "disabled"}>Score Hand${kbd("S")}</button>`;
  const rollReroll = midTurn
    ? `<button class="btn reroll" data-act="reroll" ${rerolls > 0 ? "" : "disabled"}>Reroll${kbd("R")}</button>`
    : `<button class="btn reroll" data-act="roll">Roll Dice${kbd("R")}</button>`;
  const hint = midTurn
    ? rerolls > 0
      ? `Reroll, or score the hand`
      : `Out of rerolls — scoring…`
    : `Roll to start the turn`;
  return `
    <div class="actions">
      <div class="buttons">${score}${rollReroll}</div>
      <div class="statusline">
        <span class="deck">RED DECK · ${state.dice.length}/${state.dice.length} DICE</span>
        <span class="muted">${hint}</span>
      </div>
    </div>`;
}

function renderScorePanel(): string {
  const renderChipMult = (viewState: GameState): string => {
  const bd = viewState.turn ? getScorePreview(viewState) : null;
  const chips = bd ? bd.sum + bd.add : 0;
  const mult = bd ? bd.mult : 1;
  const handScore = bd ? bd.total : 0;
  return `
      <div class="chipmult">
        <div class="chips">${fmt(chips)}<span>CHIPS</span></div>
        <div class="times">×</div>
        <div class="mult">${fmt(mult)}<span>MULT</span></div>
        <div class="eq">=</div>
        <div class="hand">${fmt(handScore)}<span>THIS HAND</span></div>
      </div>`;
  };
  const chipMult = previousRollState
    ? `<div class="roll-result-stack chipmult-stack">
        <div class="roll-result-old">${renderChipMult(previousRollState)}</div>
        <div class="roll-result-new">${renderChipMult(state)}</div>
      </div>`
    : renderChipMult(state);
  return `
    <div class="scorepanel">
      <div class="targetbox">
        <div class="label">Target Score</div>
        <div class="target-num">${fmt(state.targetScore)}</div>
        <div class="blindtag">Defeat the Blind</div>
      </div>
      <div class="currentbox">
        <div class="label">Current Score</div>
        <div class="current-num">${fmt(state.roundScore)}</div>
      </div>
      ${chipMult}
    </div>`;
}

function renderInscribeOverlay(): string {
  if (!inscribing) return "";
  const values: FaceValue[] = [1, 2, 3, 4, 5, 6];
  const btns = values
    .map((v) => `<button class="ins-val" data-act="setface" data-value="${v}">${v}</button>`)
    .join("");
  return `
    <div class="overlay">
      <div class="modal small">
        <h2>Inscribe a face</h2>
        <p class="muted">Choose the value for this face (1–6). Overwriting a filled face is allowed.</p>
        <div class="ins-vals">${btns}</div>
        <button class="btn ghost" data-act="cancel-inscribe">Cancel</button>
      </div>
    </div>`;
}

/** Pre-run setup: inscribe the single starting face, then begin. */
function renderSetupOverlay(): string {
  if (started) return "";
  const canStart = faceSkipped || pendingInscribes <= 0;
  return `
    <div class="overlay">
      <div class="modal">
        <h2>Build your die</h2>
        <p>Your die begins with a single inscribed face. Choose it, or skip to start with a blank die.</p>
        ${renderInscribeRow()}
        <button class="btn continue" data-act="start-run" ${canStart ? "" : "disabled"}>Start Run ${kbd("↵")} ${kbd("R")}</button>
      </div>
    </div>`;
}

function renderRewardOverlay(): string {
  if (state.phase !== "reward" || scoreSequencePending) return "";
  const offers = state.rewardOffers
    .map((o, i) => {
      const id = o.modifierId ?? o.id;
      const keyChar = OFFER_KEYS[i];
      const key = keyChar ? kbd(keyChar) : "";
      return `
        <button class="offer" data-act="take-card" data-offer="${o.id}">
          <div class="offer-badge">MOD ${key}</div>
          <div class="offer-name">${cardName(id)}</div>
          <div class="offer-desc">${cardDesc(id)}</div>
        </button>`;
    })
    .join("");
  const discard = pendingDiscardOffer
    ? `<div class="discard">
         <div class="discard-title">Slots full — discard one (gone forever):</div>
         <div class="discard-cards">
           ${state.acquiredModifiers
             .map((id) => `<button class="held" data-act="discard-card" data-mod="${id}">${cardName(id)}</button>`)
             .join("")}
         </div>
       </div>`
    : "";
  // The card step is done once a card is taken (offers cleared) or skipped.
  const cardResolved = cardSkipped || state.rewardOffers.length === 0;
  const faceDone = faceSkipped || pendingInscribes <= 0;
  const canContinue = cardResolved && faceDone;
  const cardBody = !cardResolved
    ? `<p>Take a card into your run, or skip it:</p>
       <div class="offers">${offers}</div>${discard}
       <button class="btn ghost skip" data-act="skip-card">Skip — no card ${kbd("X")}</button>`
    : cardSkipped
      ? `<p class="muted">No card taken this round.</p>`
      : `<p>Card taken. You hold ${state.acquiredModifiers.length}/${config.cards.slots}.</p>`;
  return `
    <div class="overlay">
      <div class="modal">
        <h2> Round ${state.round} cleared!</h2>
        ${cardBody}
        <div class="reward-inscribe">
          <p class="section-title">Add a face to your die</p>
          ${renderInscribeRow()}
        </div>
        <button class="btn continue" data-act="next-round" ${canContinue ? "" : "disabled"}>Continue ${kbd("↵")} ${kbd("R")}</button>
      </div>
    </div>`;
}

function renderGameOverOverlay(): string {
  if (state.phase !== "gameOver" || scoreSequencePending) return "";
  return `
    <div class="overlay">
      <div class="modal">
        <h2>💀 Defeated on round ${state.round}</h2>
        <p>You needed ${fmt(state.targetScore)}, reached ${fmt(state.roundScore)}.</p>
        <p class="muted">Cards held: ${
          state.acquiredModifiers.map(cardName).join(", ") || "none"
        }</p>
        <button class="btn continue" data-act="restart">New Run ${kbd("↵")} ${kbd("R")}</button>
      </div>
    </div>`;
}

/** Dev-only floating chip to A/B the roll animations. Cycles ROLL_ANIMATIONS. */
function renderAnimToggle(): string {
  return `<button class="anim-toggle" data-act="cycle-anim"
            title="Toggle roll animation">🎲 ${activeAnim}</button>`;
}

function render(): void {
  const currentDice = state.dice.map((d, i) => renderDie(d, i)).join("");
  const secondaryDice = previousRollState
    ? `<div class="roll-result-stack dice-result-stack">
        <div class="roll-result-old">${previousRollState.dice.map((d, i) => renderDie(d, i, previousRollState!)).join("")}</div>
        <div class="roll-result-new">${currentDice}</div>
      </div>`
    : currentDice;
  app.innerHTML = `
    ${renderAnimToggle()}
    <div class="game${rollResultsPending ? " roll-results-pending" : ""}">
      <aside class="sidebar">
        <div class="logo">
          <div class="mark">▲</div>
          <div class="title">POLYHEDRAL<span>roguelike dice</span></div>
        </div>
        <div class="mods-title">ACTIVE MODIFIERS</div>
        <div class="mod-slots">${renderModSlots()}</div>
        <section class="dice-secondary">
          <div class="secondary-title">YOUR DIE · FACES</div>
          ${secondaryDice}
        </section>
      </aside>
      <main class="board">
        ${renderStatBar()}
        ${renderBigDice()}
        ${renderScorePanel()}
        ${renderActions()}
      </main>
    </div>
    ${renderSetupOverlay()}
    ${renderRewardOverlay()}
    ${renderGameOverOverlay()}
    ${renderInscribeOverlay()}`;
}

// ── Event handling (delegated) ────────────────────────────────────────────────
app.addEventListener("click", (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
  const act = el?.dataset.act;

  // Clicking inside a modal shouldn't dismiss it via the overlay's cancel.
  if (!el) return;

  switch (act) {
    case "cycle-anim": {
      const i = ANIM_NAMES.indexOf(activeAnim);
      activeAnim = ANIM_NAMES[(i + 1) % ANIM_NAMES.length] ?? DEFAULT_ANIM;
      localStorage.setItem("rollAnim", activeAnim);
      render();
      playRollAnimation(); // preview the newly-selected variant immediately
      break;
    }
    case "roll":
      previousRollState = state;
      rollResultsPending = true;
      dispatch({ type: "roll" });
      playRollAnimation(true);
      break;
    case "reroll":
      previousRollState = state;
      rollResultsPending = true;
      dispatch({ type: "reroll", held: [] });
      playRollAnimation(true);
      // Re-render just replaced the box; flash the fresh one to signal the burn.
      document.querySelector(".rerolls")?.classList.add("shake");
      // No rerolls left means there's nothing left to decide — after the roll
      // animation lands so the final face is visible, score the hand automatically.
      if (state.turn && state.turn.rerollsRemaining <= 0) {
        window.setTimeout(scoreHand, 1050);
      }
      break;
    case "lockin":
      scoreHand();
      break;
    case "face": {
      if (pendingInscribes <= 0) break; // inscribing only at setup / between rounds
      inscribing = { dieId: el.dataset.die!, faceIndex: Number(el.dataset.face) };
      render();
      break;
    }
    case "setface": {
      if (inscribing) applyInscribe(inscribing.dieId, inscribing.faceIndex, Number(el.dataset.value) as FaceValue);
      break;
    }
    case "cancel-inscribe":
      inscribing = null;
      render();
      break;
    case "start-run":
      if (pendingInscribes <= 0) started = true;
      render();
      if (started) countUpTargetScore();
      break;
    case "take-card": {
      const offer = el.dataset.offer!;
      if (state.acquiredModifiers.length >= config.cards.slots) {
        pendingDiscardOffer = offer;
        render();
      } else {
        dispatch({ type: "chooseReward", rewardId: offer });
      }
      break;
    }
    case "skip-card":
      pendingDiscardOffer = null; // back out of any in-progress discard too
      cardSkipped = true;
      render();
      break;
    case "skip-face":
      inscribing = null; // close the value picker if it was open
      faceSkipped = true;
      render();
      break;
    case "discard-card": {
      if (pendingDiscardOffer) {
        const offer = pendingDiscardOffer;
        pendingDiscardOffer = null;
        dispatch({ type: "chooseReward", rewardId: offer, discard: el.dataset.mod! });
      }
      break;
    }
    case "next-round":
      dispatch({ type: "nextRound" });
      countUpTargetScore();
      break;
    case "restart":
      if (scoreTimer !== null) clearInterval(scoreTimer);
      scoreTimer = null;
      if (handCountTimer !== null) clearInterval(handCountTimer);
      handCountTimer = null;
      if (targetCountTimer !== null) clearInterval(targetCountTimer);
      targetCountTimer = null;
      if (celebrationTimer !== null) clearTimeout(celebrationTimer);
      celebrationTimer = null;
      scoreSequencePending = false;
      celebrateRoundWin = false;
      state = createInitialState(freshSeed(), config);
      inscribing = null;
      pendingDiscardOffer = null;
      cardSkipped = false;
      faceSkipped = false;
      started = false;
      pendingInscribes = 1;
      previousRollState = null;
      rollResultsPending = false;
      render();
      break;
  }
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────
// Each key maps to CSS selectors for the button it should press. We don't
// re-implement any action here: we find the button and click it, so shortcuts
// inherit the click handler's logic and the buttons' disabled state. Selectors
// are tried in order; the first enabled match wins. When an overlay is open we
// only match inside it, so board buttons underneath stay unreachable — exactly
// like clicking, where the overlay covers the board.
const shortcuts: Record<string, string[]> = {
  // Space / R press the shared Roll·Reroll button, whichever it currently is.
  " ": ["[data-act='reroll']", "[data-act='roll']"],
  r: ["[data-act='start-run']", "[data-act='next-round']", "[data-act='restart']", "[data-act='reroll']", "[data-act='roll']"],
  // S scores the hand mid-turn; during rewards it takes the 2nd offered card.
  s: ["[data-act='lockin']", ".offers .offer:nth-child(2)"],
  // A / D take the 1st / 3rd offered card.
  a: [".offers .offer:nth-child(1)"],
  d: [".offers .offer:nth-child(3)"],
  // X skips the card reward; Z skips adding a face.
  x: ["[data-act='skip-card']"],
  z: ["[data-act='skip-face']"],
  // Enter advances the primary flow: an overlay's continue button, else score
  // the hand, else roll to start the turn.
  Enter: [".btn.continue", "[data-act='lockin']", "[data-act='roll']"],
  // Esc backs out of the face-value picker.
  Escape: ["[data-act='cancel-inscribe']"],
};

window.addEventListener("keydown", (ev) => {
  if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;

  // 1–6 stamp a face while inscribing is available. If a face was clicked first
  // (value picker open) fill that face; otherwise stamp the next one directly.
  if (/^[1-6]$/.test(ev.key)) {
    const value = Number(ev.key) as FaceValue;
    if (faceSkipped) return; // face step already resolved this round
    if (inscribing) {
      applyInscribe(inscribing.dieId, inscribing.faceIndex, value);
    } else if (pendingInscribes > 0) {
      const target = nextInscribeTarget();
      if (target) applyInscribe(target.dieId, target.faceIndex, value);
      else return;
    } else return;
    ev.preventDefault();
    return;
  }

  const selectors = shortcuts[ev.key];
  if (!selectors) return;

  // Scope the search to the topmost overlay when one is open (it's rendered last).
  const overlays = document.querySelectorAll<HTMLElement>(".overlay");
  const root: ParentNode = overlays.length ? overlays[overlays.length - 1] : document;

  for (const sel of selectors) {
    const btn = root.querySelector<HTMLButtonElement>(sel);
    if (btn && !btn.disabled) {
      ev.preventDefault();
      btn.click();
      return;
    }
  }
});

render();
