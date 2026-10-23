// src/ui/components/cardLabels.js — Display names for the case library's cards.

/**
 * Display labels for library cards: the applicant's name, plus a short case number when the name
 * repeats in the library (#4, from case-gen-4-…), plus the first four characters of the id's hash when
 * that still collides. Display only: no case, id or seeded draw changes.
 */
export function cardLabels(cases) {
  const parse = (id) => { const m = /^case-gen-(\d+)-([0-9a-z]+)/.exec(id); return m ? { num: `#${m[1]}`, hash: m[2].slice(0, 4) } : { num: `#${String(id).slice(-4)}`, hash: "" }; };
  const byName = new Map();
  for (const c of cases) byName.set(c.applicant.name, [...(byName.get(c.applicant.name) ?? []), c]);
  const labels = new Map();
  for (const [name, group] of byName) {
    if (group.length === 1) { labels.set(group[0].id, name); continue; }
    const nums = group.map((c) => parse(c.id).num);
    for (const c of group) {
      const { num, hash } = parse(c.id);
      labels.set(c.id, `${name} · ${nums.filter((x) => x === num).length > 1 && hash ? `${num}-${hash}` : num}`);
    }
  }
  return labels;
}
