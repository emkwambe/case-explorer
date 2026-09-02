// src/analytics/network.js — Entity and network analytics across a batch of applications.
//
// Builds a bipartite graph of applications ↔ entities (devices, IP addresses, employers,
// addresses, document fingerprints, bank-deposit sources) and identifies shared entities,
// application clusters and coordinated rings. Operates on the underwriter-visible layers only.

import crypto from "crypto";

export const NETWORK_ANALYTICS_VERSION = "1.0.0";

export const ENTITY_TYPES = Object.freeze(["DEVICE", "IP", "EMPLOYER", "ADDRESS", "DOCUMENT", "DEPOSIT_SOURCE"]);

/** A document fingerprint derived from underwriter-visible document metadata (not content). */
export function documentFingerprint(doc) {
  if (doc.content_hash) return `doc:${doc.content_hash}`;
  return "doc:" + crypto.createHash("sha1").update(`${doc.source}|${doc.created}|${doc.modified}|${doc.pdf_generator}`).digest("hex").slice(0, 16);
}

export function extractEntities(c) {
  const md = c.application_metadata || {};
  const claims = c.presentation?.current_state || {};
  const housing = c.presentation?.events?.filter(e => e.type === "ADDRESS_CHANGE") || [];
  const currentAddress = housing[housing.length - 1]?.address;
  const bank = c.evidence?.find(e => e.source === "BANK_STATEMENT")?.fields || {};
  const entities = [];
  if (md.device_fingerprint) entities.push({ type: "DEVICE", key: `device:${md.device_fingerprint}` });
  if (md.ip_address) entities.push({ type: "IP", key: `ip:${md.ip_address}` });
  if (claims.employer) entities.push({ type: "EMPLOYER", key: `employer:${claims.employer.toLowerCase()}` });
  if (currentAddress) entities.push({ type: "ADDRESS", key: `address:${currentAddress.toLowerCase()}` });
  for (const d of md.documents || []) entities.push({ type: "DOCUMENT", key: documentFingerprint(d) });
  for (const dep of bank.recent_large_deposits || []) if (dep.source_account) entities.push({ type: "DEPOSIT_SOURCE", key: `deposit:${dep.source_account}` });
  return entities;
}

/** Entity types whose sharing is suspicious. Employers are shared legitimately at scale. */
const SUSPICIOUS_SHARE = Object.freeze({ DEVICE: 2, IP: 3, ADDRESS: 3, DOCUMENT: 2, DEPOSIT_SOURCE: 2, EMPLOYER: 25 });

/**
 * Build the entity graph and find clusters.
 * @returns {{ entities, shared_entities, clusters, case_findings, summary }}
 */
export function analyzeNetwork(cases) {
  const entityIndex = new Map(); // key -> { type, key, cases: Set }
  const caseEntities = new Map();
  for (const c of cases) {
    const ents = extractEntities(c);
    caseEntities.set(c.id, ents);
    for (const e of ents) {
      const rec = entityIndex.get(e.key) || { type: e.type, key: e.key, cases: new Set() };
      rec.cases.add(c.id);
      entityIndex.set(e.key, rec);
    }
  }
  const shared = [...entityIndex.values()].filter(e => e.cases.size >= SUSPICIOUS_SHARE[e.type]).map(e => ({ type: e.type, key: e.key, case_count: e.cases.size, cases: [...e.cases] }));

  // Union-find over cases connected by suspicious shared entities (employers excluded from linkage).
  const parent = new Map(cases.map(c => [c.id, c.id]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const e of shared) if (e.type !== "EMPLOYER") { const ids = e.cases; for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]); }
  const groups = new Map();
  for (const c of cases) { const r = find(c.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c.id); }
  const clusters = [...groups.values()].filter(g => g.length >= 2).map((ids, i) => {
    const linking = shared.filter(e => e.type !== "EMPLOYER" && e.cases.some(id => ids.includes(id)));
    const types = [...new Set(linking.map(e => e.type))];
    const density = linking.length / ids.length;
    const risk = ids.length >= 4 && types.length >= 2 ? "HIGH" : ids.length >= 3 || types.length >= 2 ? "MEDIUM" : "LOW";
    return { cluster_id: `cluster-${i + 1}`, size: ids.length, cases: ids, linking_entity_types: types, linking_entities: linking.map(e => e.key), density: +density.toFixed(2), risk };
  }).sort((a, b) => b.size - a.size);

  const caseFindings = {};
  for (const cl of clusters) for (const id of cl.cases) {
    caseFindings[id] = { cluster_id: cl.cluster_id, cluster_size: cl.size, linking_entity_types: cl.linking_entity_types, risk: cl.risk, reason_code: "SHARED_ENTITY_LINKAGE" };
  }
  return {
    version: NETWORK_ANALYTICS_VERSION,
    cases: cases.length,
    entities: entityIndex.size,
    shared_entities: shared,
    clusters,
    case_findings: caseFindings,
    summary: {
      shared_devices: shared.filter(e => e.type === "DEVICE").length,
      shared_ips: shared.filter(e => e.type === "IP").length,
      shared_addresses: shared.filter(e => e.type === "ADDRESS").length,
      reused_employers: shared.filter(e => e.type === "EMPLOYER").length,
      repeated_document_fingerprints: shared.filter(e => e.type === "DOCUMENT").length,
      clusters: clusters.length,
      cases_in_clusters: Object.keys(caseFindings).length,
      high_risk_clusters: clusters.filter(c => c.risk === "HIGH").length
    }
  };
}

/** Evaluate ring recovery against injected ground truth (meta.ring_id). */
export function evaluateNetworkDetection(cases, analysis) {
  const rings = {};
  for (const c of cases) if (c.meta?.ring_id) (rings[c.meta.ring_id] ||= []).push(c.id);
  const ringIds = Object.keys(rings);
  let recovered = 0, membersFlagged = 0, members = 0;
  for (const rid of ringIds) {
    const ids = rings[rid];
    members += ids.length;
    const flagged = ids.filter(id => analysis.case_findings[id]);
    membersFlagged += flagged.length;
    // A ring counts as recovered if ≥ half its members land in the same cluster.
    const byCluster = {};
    for (const id of flagged) byCluster[analysis.case_findings[id].cluster_id] = (byCluster[analysis.case_findings[id].cluster_id] || 0) + 1;
    if (Math.max(0, ...Object.values(byCluster)) >= Math.ceil(ids.length / 2)) recovered++;
  }
  const nonRing = cases.filter(c => !c.meta?.ring_id);
  const nonRingFlagged = nonRing.filter(c => analysis.case_findings[c.id]).length;
  return {
    rings_injected: ringIds.length,
    rings_recovered: recovered,
    ring_recall: ringIds.length ? +(recovered / ringIds.length).toFixed(4) : null,
    member_recall: members ? +(membersFlagged / members).toFixed(4) : null,
    non_ring_false_positive_rate: nonRing.length ? +(nonRingFlagged / nonRing.length).toFixed(4) : 0
  };
}
