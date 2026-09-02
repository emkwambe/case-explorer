// src/simulation/rings.js — Coordinated-application (fraud ring) injection at batch level.
//
// Individual cases are generated independently. A ring makes k of them share underwriter-visible
// entities (device fingerprint, IP, current address, document fingerprints, employer) so that
// network analytics has something real to find. Ground truth is recorded in meta.ring_id.

import { createRng } from "../utils/prng.js";
import { randomInt, randomChoice } from "../utils/distributions.js";

export const RING_INJECTION_VERSION = "1.0.0";

/**
 * @param {Array} cases   generated cases (mutated in place)
 * @param {object} opts   { seed, ringCount, minSize, maxSize, preferFraud }
 */
export function injectFraudRings(cases, { seed = "rings", ringCount = 3, minSize = 3, maxSize = 6, preferFraud = true } = {}) {
  const rng = createRng(seed);
  const pool = cases.map((c, i) => ({ c, i })).filter(x => !x.c.meta?.ring_id);
  const fraudPool = pool.filter(x => x.c.meta?.corruption_type && x.c.meta.corruption_type !== "NONE" && x.c.meta.corruption_type !== "INCOHERENT");
  const rings = [];
  for (let r = 0; r < ringCount; r++) {
    const size = randomInt(minSize, maxSize, rng);
    const source = preferFraud && fraudPool.length >= size ? fraudPool : pool;
    if (source.length < size) break;
    const members = [];
    while (members.length < size) {
      const idx = Math.floor(rng.random() * source.length);
      const pick = source[idx];
      if (pick.c.meta?.ring_id || members.includes(pick)) continue;
      members.push(pick);
    }
    const ringId = `ring-${seed}-${r + 1}`;
    const sharedDevice = members[0].c.application_metadata.device_fingerprint;
    const sharedIp = members[0].c.application_metadata.ip_address;
    const sharedEmployer = members[0].c.presentation.current_state.employer;
    const sharedAddress = `${randomInt(100, 9999, rng)} ${randomChoice(["Harbor", "Summit", "Meridian", "Liberty"], rng)} ${randomChoice(["Way", "Ct", "Ln"], rng)}`;
    const sharedDocs = members[0].c.application_metadata.documents.map(d => ({ ...d }));
    for (const m of members) {
      const c = m.c;
      const pattern = rng.random();
      // Not every member shares every entity — rings reuse infrastructure imperfectly.
      if (pattern < 0.85) c.application_metadata.device_fingerprint = sharedDevice;
      if (rng.random() < 0.7) c.application_metadata.ip_address = sharedIp;
      if (rng.random() < 0.6) {
        c.presentation.current_state.employer = sharedEmployer;
        const start = c.presentation.events.find(e => e.type === "EMPLOYMENT_START");
        if (start) start.entity = sharedEmployer;
      }
      if (rng.random() < 0.5) {
        const housing = c.presentation.events.filter(e => e.type === "ADDRESS_CHANGE");
        if (housing.length) housing[housing.length - 1].address = sharedAddress;
      }
      if (rng.random() < 0.6) c.application_metadata.documents = sharedDocs.map(d => ({ ...d }));
      c.meta.ring_id = ringId;
      c.meta.ring_size = size;
    }
    rings.push({ ring_id: ringId, size, members: members.map(m => m.c.id), shared: { device: sharedDevice, ip: sharedIp, employer: sharedEmployer, address: sharedAddress } });
  }
  return rings;
}
