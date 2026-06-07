// Shared RNG for all draft-simulation randomness (AI bidding, strategies,
// engine jitter). Unseeded it delegates to Math.random, so app behavior is
// unchanged; tests call setSeed() to make full simulated drafts deterministic.

// mulberry32 — small, fast, good-enough 32-bit PRNG for simulation tests.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// null → unseeded. random() then calls Math.random dynamically (not a captured
// reference), so test spies on Math.random keep working.
let generator = null

export function random() {
  return generator ? generator() : Math.random()
}

export function setSeed(seed) {
  generator = mulberry32(seed)
}

export function resetRng() {
  generator = null
}
