// src/profiles/sunlight/publicRecordData.js — The pinned public-record snapshot for the Solar prime
// profile, plus the notes the Public record tab and the README show. Loaded lazily by the tab; the
// browser never calls SEC or FRED.

import quarterly from "../../../data/public-record/sunlight-quarterly.json";
import manifest from "../../../data/public-record/manifest.json";
import eventsFile from "../../../data/public-record/events.json";

import { PUBLIC_RECORD_NOTES } from "./publicRecordNotes.js";
import * as analyses from "./publicRecord.js";

export const PUBLIC_RECORD = Object.freeze({
  ...PUBLIC_RECORD_NOTES,
  quarterly,
  manifest,
  events: eventsFile.events,
  // The analysis functions travel with the data, so the tab needs no import from this folder.
  analyses
});
