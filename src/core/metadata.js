// src/core/metadata.js — Application and document metadata generation.

import {
  randomInt,
  randomChoice,
  clamp,
  randomNormal
} from "../utils/distributions.js";

function generateIpAddress(rng) {
  return `${randomInt(1, 255, rng)}.${randomInt(0, 255, rng)}.${randomInt(0, 255, rng)}.${randomInt(1, 254, rng)}`;
}

function generateDeviceFingerprint(rng) {
  const chars = "0123456789abcdef";
  return Array.from({ length: 32 }, () => chars[Math.floor(rng.random() * chars.length)]).join("");
}

function generateDocumentMetadata(source, submissionDate, isFraud, rng) {
  const submitted = new Date(submissionDate);
  // Fraudsters generate docs right before submission; legitimate docs are older
  const maxAgeDays = isFraud ? 3 : 180;
  const minAgeDays = isFraud ? 0 : 14;
  const ageDays = minAgeDays + Math.floor(rng.random() * (maxAgeDays - minAgeDays + 1));
  // UTC arithmetic, so the dates are the same in every process time zone.
  const created = new Date(submitted);
  created.setUTCDate(created.getUTCDate() - ageDays);
  const modified = new Date(created);
  modified.setUTCHours(modified.getUTCHours() + Math.floor(rng.random() * 24));
  return {
    source,
    created: created.toISOString().split('T')[0],
    modified: modified.toISOString().split('T')[0],
    pdf_generator: randomChoice(["Adobe PDF Library", "Microsoft Print to PDF", "Chrome PDF Generator", "DocuSign", "Smallpdf"], rng),
    content_hash: generateDeviceFingerprint(rng), // stands in for a hash of the document bytes
    days_before_submission: ageDays
  };
}

const FRAUD_TYPES = new Set(["INFLATION", "CONCEALMENT", "FABRICATION", "BUST_OUT", "EVIDENCE_TAMPERING", "OCCUPANCY_MISREPRESENTATION", "GIFT_FUND_MISREPRESENTATION", "ASSET_SEASONING", "STRAW_BUYER"]);

/**
 * @param {number} fraudSignalRate  share of fraud cases that exhibit risky device/behaviour metadata.
 *   Real fraud does not always come from a Tor exit node; documented in PARAMETER_SOURCES.md.
 */
export function generateApplicationMetadata(submissionDate, corruptionType, severity, rng = { random: () => Math.random() }, fraudSignalRate = 0.6) {
  const isFraudType = FRAUD_TYPES.has(corruptionType);
  const isFraud = isFraudType && rng.random() < fraudSignalRate;
  const fraudIntensity = severity === "HIGH" ? 1.0 : severity === "MEDIUM" ? 0.6 : 0.3;

  // Submission timing
  let hour, dayOfWeek;
  if (isFraud && rng.random() < 0.45 * fraudIntensity) {
    hour = randomInt(0, 5, rng); // late-night fraudster hours
    dayOfWeek = randomChoice([0, 6, 5], rng); // weekend/night
  } else {
    hour = randomInt(9, 17, rng);
    dayOfWeek = randomInt(1, 5, rng);
  }
  const submitted = new Date(submissionDate);
  submitted.setUTCHours(hour, randomInt(0, 59, rng), 0, 0);

  // IP / device
  const ipRiskBase = isFraud ? 0.55 : 0.08;
  const ipRiskScore = clamp(ipRiskBase + rng.random() * (isFraud ? 0.45 : 0.15), 0, 1);
  const isVpn = isFraud ? rng.random() < 0.35 * fraudIntensity : rng.random() < 0.05;
  const isTor = isFraud ? rng.random() < 0.12 * fraudIntensity : rng.random() < 0.005;

  // Behavioral biometrics
  const typingSpeed = isFraud
    ? clamp(randomNormal(65, 25, rng), 25, 140) // fast / robotic
    : clamp(randomNormal(42, 12, rng), 18, 90);
  const fieldsCopyPasted = isFraud
    ? randomInt(2, 8, rng)
    : randomInt(0, 2, rng);
  const sessionDuration = isFraud
    ? clamp(randomNormal(180, 90, rng), 45, 600) // short, rushed
    : clamp(randomNormal(480, 180, rng), 120, 1800);
  const usedAutofill = isFraud ? rng.random() < 0.25 : rng.random() < 0.65;

  return {
    submitted: submitted.toISOString(),
    hour_of_day: hour,
    day_of_week: dayOfWeek,
    is_business_hours: hour >= 9 && hour <= 17 && dayOfWeek >= 1 && dayOfWeek <= 5 ? 1 : 0,
    device_fingerprint: generateDeviceFingerprint(rng),
    ip_address: generateIpAddress(rng),
    ip_risk_score: parseFloat(ipRiskScore.toFixed(3)),
    is_vpn: isVpn ? 1 : 0,
    is_tor: isTor ? 1 : 0,
    isp: randomChoice(["Comcast", "Verizon", "AT&T", "Spectrum", "T-Mobile", "Google Fiber", "Unknown ISP"], rng),
    typing_speed_wpm: Math.round(typingSpeed),
    fields_copy_pasted: fieldsCopyPasted,
    session_duration_seconds: Math.round(sessionDuration),
    used_autofill: usedAutofill ? 1 : 0,
    documents: [
      generateDocumentMetadata("W2_DOCUMENT", submissionDate, isFraud, rng),
      generateDocumentMetadata("BANK_STATEMENT", submissionDate, isFraud, rng),
      generateDocumentMetadata("CREDIT_BUREAU", submissionDate, isFraud, rng),
      generateDocumentMetadata("EMPLOYER_VERIFICATION", submissionDate, isFraud, rng)
    ]
  };
}
