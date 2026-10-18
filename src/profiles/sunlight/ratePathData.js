// src/profiles/sunlight/ratePathData.js — Daily 10-year Treasury yields (FRED DGS10) for the
// Funding & Rates historical rate paths, built at build time from the committed raw FRED file.
// Loaded lazily; the browser never calls FRED.

import daily from "../../../data/public-record/dgs10-daily.json";
import manifest from "../../../data/public-record/manifest.json";

export const DGS10_DAILY = Object.freeze({
  ...daily,
  // The manifest entry that hashes this file and names the raw file it was built from.
  manifestEntry: manifest.derived?.find((d) => d.id === "dgs10-daily") ?? null
});
