// src/ui/tabs/importance.js — Rows of the fraud model's feature-importance table (Explanation tab).

/**
 * Rows of the pipeline's importance table. Its global_importance rows carry `permutation_importance`
 * (drop in average precision when the feature is shuffled) and `native_importance` (the model's own
 * split-gain share); an older object form maps a feature to one value.
 */
export function importanceRows(importance) {
  if (!importance) return [];
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : null);
  if (!Array.isArray(importance)) return Object.entries(importance).map(([feature, value]) => ({ feature, permutation: num(value), native: null }));
  return importance.map((r) => ({ feature: r.feature, permutation: num(r.permutation_importance ?? r.importance ?? r.value), native: num(r.native_importance) }));
}
