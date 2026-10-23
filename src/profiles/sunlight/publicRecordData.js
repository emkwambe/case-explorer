// src/profiles/sunlight/publicRecordData.js — The pinned public-record snapshot for the Solar prime
// profile, plus the notes the Public record tab and the README show. Loaded lazily by the tab; the
// browser never calls SEC or FRED.

import quarterly from "../../../data/public-record/sunlight-quarterly.json";
import manifest from "../../../data/public-record/manifest.json";
import eventsFile from "../../../data/public-record/events.json";
// Public data (Sprint 8.5): peer lenders, complaint counts, credit conditions and court-filing facts.
import publicDataConfig from "../../../data/public-record/public-data-config.json";
import peers from "../../../data/public-record/peers-quarterly.json";
import complaints from "../../../data/public-record/cfpb-complaints.json";
import macro from "../../../data/public-record/macro-credit.json";
import courtFile from "../../../data/public-record/court-filings.json";

import { PUBLIC_RECORD_NOTES } from "./publicRecordNotes.js";
import * as analyses from "./publicRecord.js";

export const PUBLIC_RECORD = Object.freeze({
  ...PUBLIC_RECORD_NOTES,
  quarterly,
  manifest,
  events: eventsFile.events,
  // Court facts are shown only on the Public record timeline; `events` (also drawn by Findings) is unchanged.
  publicData: Object.freeze({ config: publicDataConfig, peers, complaints, macro, courtFilings: courtFile.facts, documents: publicDataConfig.court.documents }),
  // The analysis functions travel with the data, so the tab needs no import from this folder.
  analyses
});
