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
  // Finishing a round grants one face to inscribe in the reward step.
  if (state.phase === "reward" && before !== "reward") pendingInscribes = 1;
  render();
}

// ── Small helpers ────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString("en-US");
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
        <div class="mod">
          <div class="mod-badge">MOD</div>
          <div class="mod-name">${cardName(id)}</div>
          <div class="mod-desc">${cardDesc(id)}</div>
        </div>`);
    }
  }
  return cells.join("");
}

/** The board die — display only. Faces are inscribed between rounds, not here. */
function renderDie(die: Die, dieIdx: number): string {
  const rolledFace = state.turn?.roll.find((r) => r.dieId === die.id)?.faceIndex ?? null;
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

/** Clickable die faces used inside the setup / reward modals for inscribing. */
function renderInscribeRow(): string {
  const spent = pendingInscribes <= 0;
  const dice = state.dice
    .map((die, dieIdx) => {
      const tiles = die.faces
        .map((f, i) => {
          const blank = f.value === null;
          return `
            <button class="face small${blank ? " blank" : ""}"
                    data-act="face" data-die="${die.id}" data-face="${i}" ${spent ? "disabled" : ""}>
              <span class="pip">${blank ? "" : f.value}</span>
            </button>`;
        })
        .join("");
      return `<div class="die"><div class="die-label">DIE ${dieIdx + 1}</div><div class="faces">${tiles}</div></div>`;
    })
    .join("");
  const note = spent
    ? `<p class="muted">✓ Face added.</p>`
    : `<p class="muted">Click a face to inscribe it (${pendingInscribes} to add). Overwriting a filled face is allowed.</p>`;
  return `<div class="inscribe-section">${note}${dice}</div>`;
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
  const primary = midTurn
    ? `<button class="btn score" data-act="lockin">Score Hand</button>`
    : `<button class="btn score" data-act="roll">Roll Dice</button>`;
  const reroll = `<button class="btn reroll" data-act="reroll" ${midTurn && rerolls > 0 ? "" : "disabled"}>Reroll</button>`;
  const hint = midTurn ? `Score the hand, or reroll while you can` : `Roll to start the turn`;
  return `
    <div class="actions">
      <div class="buttons">${primary}${reroll}</div>
      <div class="statusline">
        <span class="deck">RED DECK · ${state.dice.length}/${state.dice.length} DICE</span>
        <span class="muted">${hint}</span>
      </div>
    </div>`;
}

function renderScorePanel(): string {
  const bd = state.turn ? getScorePreview(state) : null;
  const chips = bd ? bd.sum + bd.add : 0;
  const mult = bd ? bd.mult : 1;
  const handScore = bd ? bd.total : 0;
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
      <div class="chipmult">
        <div class="chips">${fmt(chips)}<span>CHIPS</span></div>
        <div class="times">×</div>
        <div class="mult">${fmt(mult)}<span>MULT</span></div>
        <div class="eq">=</div>
        <div class="hand">${fmt(handScore)}<span>THIS HAND</span></div>
      </div>
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
  const canStart = pendingInscribes <= 0;
  return `
    <div class="overlay">
      <div class="modal">
        <h2>Build your die</h2>
        <p>Your die begins with a single inscribed face. Choose it, then start the run.</p>
        ${renderInscribeRow()}
        <button class="btn continue" data-act="start-run" ${canStart ? "" : "disabled"}>Start Run →</button>
      </div>
    </div>`;
}

function renderRewardOverlay(): string {
  if (state.phase !== "reward") return "";
  const offers = state.rewardOffers
    .map((o) => {
      const id = o.modifierId ?? o.id;
      return `
        <button class="offer" data-act="take-card" data-offer="${o.id}">
          <div class="offer-badge">MOD</div>
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
  const cardDone = state.rewardOffers.length === 0;
  const faceDone = pendingInscribes <= 0;
  const canContinue = cardDone && faceDone;
  const cardBody = state.rewardOffers.length
    ? `<p>Take a card into your run:</p><div class="offers">${offers}</div>${discard}`
    : `<p>Card taken. You hold ${state.acquiredModifiers.length}/${config.cards.slots}.</p>`;
  return `
    <div class="overlay">
      <div class="modal">
        <h2>✅ Round ${state.round} cleared!</h2>
        ${cardBody}
        <div class="reward-inscribe">
          <p class="section-title">Add a face to your die</p>
          ${renderInscribeRow()}
        </div>
        <button class="btn continue" data-act="next-round" ${canContinue ? "" : "disabled"}>Continue →</button>
      </div>
    </div>`;
}

function renderGameOverOverlay(): string {
  if (state.phase !== "gameOver") return "";
  return `
    <div class="overlay">
      <div class="modal">
        <h2>💀 Defeated on round ${state.round}</h2>
        <p>You needed ${fmt(state.targetScore)}, reached ${fmt(state.roundScore)}.</p>
        <p class="muted">Cards held: ${
          state.acquiredModifiers.map(cardName).join(", ") || "none"
        }</p>
        <button class="btn continue" data-act="restart">New Run →</button>
      </div>
    </div>`;
}

function render(): void {
  app.innerHTML = `
    <div class="game">
      <aside class="sidebar">
        <div class="logo">
          <div class="mark">▲</div>
          <div class="title">POLYHEDRAL<span>roguelike dice</span></div>
        </div>
        <div class="mods-title">ACTIVE MODIFIERS</div>
        <div class="mod-slots">${renderModSlots()}</div>
      </aside>
      <main class="board">
        ${renderStatBar()}
        ${renderScorePanel()}
        <section class="dice-area">
          ${state.dice.map((d, i) => renderDie(d, i)).join("")}
        </section>
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
    case "roll":
      dispatch({ type: "roll" });
      break;
    case "reroll":
      dispatch({ type: "reroll", held: [] });
      // Re-render just replaced the box; flash the fresh one to signal the burn.
      document.querySelector(".rerolls")?.classList.add("shake");
      break;
    case "lockin":
      dispatch({ type: "lockIn" });
      // If the round continues, flash the rolls-left box to mark the spent roll.
      document.querySelector(".rolls-left")?.classList.add("shake");
      break;
    case "face": {
      if (pendingInscribes <= 0) break; // inscribing only at setup / between rounds
      inscribing = { dieId: el.dataset.die!, faceIndex: Number(el.dataset.face) };
      render();
      break;
    }
    case "setface": {
      if (inscribing) {
        const target = inscribing;
        inscribing = null;
        pendingInscribes = Math.max(0, pendingInscribes - 1);
        dispatch({
          type: "inscribeFace",
          dieId: target.dieId,
          faceIndex: target.faceIndex,
          value: Number(el.dataset.value) as FaceValue,
        });
      }
      break;
    }
    case "cancel-inscribe":
      inscribing = null;
      render();
      break;
    case "start-run":
      if (pendingInscribes <= 0) started = true;
      render();
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
      break;
    case "restart":
      state = createInitialState(freshSeed(), config);
      inscribing = null;
      pendingDiscardOffer = null;
      started = false;
      pendingInscribes = 1;
      render();
      break;
  }
});

render();
