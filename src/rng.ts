/**
 * Deterministic, named-stream PRNG.
 *
 * A master seed derives one independently-seeded stream per name, so tweaking
 * one axis of randomness (e.g. the reward pool) never reshuffles another (dice
 * rolls). No `Math.random()` — everything flows from the seed. Stream state is
 * a plain number, so it serializes as part of the game state.
 */

export type StreamName = string;

/** The full RNG state: one 32-bit generator state per named stream. */
export interface RngState {
  readonly streams: Readonly<Record<StreamName, number>>;
}

/** Deterministic 32-bit string hash (cyrb53, folded to 32 bits). */
export function hashSeed(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) ^ (h1 >>> 0);
}

/** One mulberry32 step: pure, returns the drawn float in [0, 1) and the next state. */
function step(state: number): { value: number; next: number } {
  let a = state | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, next: a };
}

/** Build an RngState from a master seed and the set of stream names to derive. */
export function createRng(masterSeed: string, streamNames: readonly StreamName[]): RngState {
  const streams: Record<StreamName, number> = {};
  for (const name of streamNames) {
    streams[name] = hashSeed(`${masterSeed}::${name}`);
  }
  return { streams };
}

function streamState(rng: RngState, stream: StreamName): number {
  const s = rng.streams[stream];
  if (s === undefined) {
    throw new Error(`Unknown RNG stream: "${stream}". Declare it when creating the match.`);
  }
  return s;
}

function withStream(rng: RngState, stream: StreamName, next: number): RngState {
  return { streams: { ...rng.streams, [stream]: next } };
}

/** Draw a float in [0, 1) from a named stream, returning the value and the advanced RngState. */
export function drawFloat(rng: RngState, stream: StreamName): { value: number; rng: RngState } {
  const { value, next } = step(streamState(rng, stream));
  return { value, rng: withStream(rng, stream, next) };
}

/** Draw an integer in [0, maxExclusive) from a named stream. */
export function drawInt(
  rng: RngState,
  stream: StreamName,
  maxExclusive: number,
): { value: number; rng: RngState } {
  const { value, rng: nextRng } = drawFloat(rng, stream);
  return { value: Math.floor(value * maxExclusive), rng: nextRng };
}
