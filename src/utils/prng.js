// src/utils/prng.js — Seeded PRNG utilities (Mulberry32).

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed) {
  if (seed === undefined || seed === null || seed === "") return { random: () => Math.random(), seeded: false };
  let s = typeof seed === "number" ? seed : hashString(String(seed));
  return {
    seeded: true,
    random: () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };
}
