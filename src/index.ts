/** Public API for the roguelike-dice engine. */

export * from "./types.js";
export { createInitialState, reduce, replay } from "./reducer.js";
export { scoreTurn } from "./scoring.js";
export { cardModifiers, cardRegistry } from "./cards.js";
export { getDice, getLastScore, getScorePreview, getLegalActions } from "./selectors.js";
export {
  createRng,
  drawFloat,
  drawInt,
  hashSeed,
} from "./rng.js";
export type { RngState, StreamName } from "./rng.js";
