// scripts/lib/utc.mjs — Pins the process time zone to UTC. Import it first.
//
// The generator builds event, document and submission dates in local time, so the same seed
// gives different dates (and different case hashes) on machines in different time zones.
// ES module imports run before the importing script's own statements, so this assignment
// lives in its own module: imported first, it runs before any other module creates a date.
process.env.TZ = "UTC";
