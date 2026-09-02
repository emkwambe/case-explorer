// src/core/findings.js — Alignment findings, ground-truth findings, and decision engine.

import { randomChoice, formatMoney } from "../utils/distributions.js";
import { REASON_CODE_CATALOG_VERSION } from "../decisioning/reason-codes/catalog.js";

function pushFinding(findings, dimension, level, status, details) {
  findings.push({ dimension, level, status, details });
}

export function generateAlignmentFindings(truth, presentation, evidence, metadata = {}) {
  const findings = [];
  const t = truth.current_state;
  const p = presentation.current_state;
  const w2 = evidence.find(e => e.source === "W2_DOCUMENT")?.fields || {};
  const bank = evidence.find(e => e.source === "BANK_STATEMENT")?.fields || {};

  // 1. Identity alignment
  if (p.synthetic_identity) {
    pushFinding(findings, "identity", "A5", "SYNTHETIC_IDENTITY", "Presentation flagged as a synthetic identity with compressed credit-building history.");
  } else {
    // Heuristic synthetic-identity signals
    const liabEvents = presentation.events.filter(e => e.type === "LIABILITY_OPENED");
    const dates = liabEvents.map(e => new Date(e.t)).sort((a, b) => a - b);
    const clustered = dates.length >= 2 && (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24) <= 90;
    const thinButPrime = (p.credit_score ?? t.credit_score) >= 720 && liabEvents.length <= 2;
    if (clustered && thinButPrime) {
      pushFinding(findings, "identity", "A4", "PROBABLE_SYNTHETIC_IDENTITY", "Credit accounts are tightly clustered and score is high despite thin file; possible synthetic identity.");
    } else {
      pushFinding(findings, "identity", "A0", "ALIGNED", "Applicant name, age, and SSN are consistent across application and evidence.");
    }
  }

  // 2. Employer alignment
  if (p.employer !== t.employer) {
    pushFinding(findings, "employment", "A4", "PROBABLE_MANIPULATION", `Application claims ${p.employer}; employer verification shows ${t.employer}.`);
  } else {
    pushFinding(findings, "employment", "A0", "ALIGNED", `Employer ${t.employer} verified.`);
  }

  // 3. Income reconciliation
  const w2Wages = w2.w2_wages ?? t.salary;
  const salaryDiff = p.salary - t.salary;
  if (Math.abs(salaryDiff) <= 1000) {
    pushFinding(findings, "income", "A0", "ALIGNED", `Self-reported ${formatMoney(p.salary)} matches verified income ${formatMoney(t.salary)}.`);
  } else if (salaryDiff > 0 && salaryDiff <= t.salary * 0.15) {
    pushFinding(findings, "income", "A1", "ROUNDING_VARIANCE", `Self-reported ${formatMoney(p.salary)} is ${formatMoney(salaryDiff)} higher than verified ${formatMoney(t.salary)}.`);
  } else if (salaryDiff > t.salary * 0.15) {
    pushFinding(findings, "income", "A4", "PROBABLE_MANIPULATION", `Self-reported ${formatMoney(p.salary)} is ${formatMoney(salaryDiff)} higher than verified ${formatMoney(t.salary)} / W-2 ${formatMoney(w2Wages)}.`);
  } else {
    pushFinding(findings, "income", "A2", "EXPLAINABLE_DISCREPANCY", `Self-reported ${formatMoney(p.salary)} is ${formatMoney(Math.abs(salaryDiff))} lower than verified ${formatMoney(t.salary)}.`);
  }

  // 4. Asset reconciliation
  const bankBalance = bank.checking_balance ?? t.checking_balance;
  const checkingDiff = p.checking_balance - t.checking_balance;
  if (Math.abs(checkingDiff) <= 500) {
    pushFinding(findings, "assets", "A0", "ALIGNED", `Self-reported checking ${formatMoney(p.checking_balance)} matches bank statement ${formatMoney(bankBalance)}.`);
  } else if (checkingDiff > 0) {
    pushFinding(findings, "assets", "A3", "MATERIAL_MISMATCH", `Self-reported checking ${formatMoney(p.checking_balance)} is ${formatMoney(checkingDiff)} higher than bank ${formatMoney(t.checking_balance)}.`);
  } else {
    pushFinding(findings, "assets", "A1", "ROUNDING_VARIANCE", `Self-reported checking ${formatMoney(p.checking_balance)} is slightly lower than bank ${formatMoney(t.checking_balance)}.`);
  }

  // 5. Liability reconciliation
  const disclosedCount = truth.events.filter(e => e.type === "LIABILITY_OPENED").length;
  const presentedCount = presentation.events.filter(e => e.type === "LIABILITY_OPENED").length;
  const actualObligations = t.monthly_obligations;
  const presentedObligations = p.monthly_obligations;
  if (presentedObligations < actualObligations) {
    const hidden = actualObligations - presentedObligations;
    pushFinding(findings, "liabilities", "A3", "MATERIAL_MISMATCH", `Application discloses ${presentedCount} liability/liabilities ($${presentedObligations}/mo); credit bureau shows ${disclosedCount} ($${actualObligations}/mo). Hidden debt: $${hidden}/mo.`);
  } else {
    pushFinding(findings, "liabilities", "A0", "ALIGNED", `Application liabilities match credit bureau (${presentedCount} accounts, $${presentedObligations}/mo).`);
  }

  // 6. Address alignment (no address data yet)
  pushFinding(findings, "address", "A0", "NOT_VERIFIED", "Address data not collected in current model; assumed consistent.");

  // 7. Timeline consistency
  const presEmpStart = presentation.events.find(e => e.type === "EMPLOYMENT_START");
  const truthEmpStart = truth.events.find(e => e.type === "EMPLOYMENT_START");
  if (presEmpStart && truthEmpStart && presEmpStart.entity !== truthEmpStart.entity) {
    pushFinding(findings, "timeline", "A4", "IMPOSSIBLE_SEQUENCE", `Employment history claims ${presEmpStart.entity} but verification shows ${truthEmpStart.entity}.`);
  } else {
    pushFinding(findings, "timeline", "A0", "ALIGNED", `Employment and liability timeline is consistent.`);
  }

  // 8. Cash-flow consistency
  const monthlyIncome = p.salary / 12;
  const housingPayment = p.monthly_mortgage_payment ?? 0;
  const monthlyOutflow = presentedObligations + housingPayment;
  const residualIncome = monthlyIncome - monthlyOutflow;
  if (residualIncome < 0) {
    pushFinding(findings, "cash_flow", "A3", "NEGATIVE_RESIDUAL", `Monthly income ${formatMoney(monthlyIncome)} is insufficient for obligations ${formatMoney(presentedObligations)} plus proposed mortgage ${formatMoney(housingPayment)}.`);
  } else if (residualIncome < monthlyIncome * 0.05) {
    pushFinding(findings, "cash_flow", "A2", "TIGHT_RESIDUAL", `Residual income is tight after obligations and proposed mortgage.`);
  } else {
    pushFinding(findings, "cash_flow", "A0", "ALIGNED", `Cash flow supports disclosed obligations and proposed mortgage with comfortable residual income.`);
  }

  // 9. Loan affordability / decision consistency
  const backendDti = p.backend_dti ?? t.backend_dti ?? p.dti ?? t.dti;
  const pitiText = housingPayment > 0 ? ` (PITI ${formatMoney(housingPayment)})` : '';
  if (backendDti > 0.50) {
    pushFinding(findings, "affordability", "A4", "EXCESSIVE_DTI", `Back-end DTI ${(backendDti * 100).toFixed(1)}%${pitiText} exceeds policy maximum.`);
  } else if (backendDti > 0.43) {
    pushFinding(findings, "affordability", "A3", "ELEVATED_DTI", `Back-end DTI ${(backendDti * 100).toFixed(1)}%${pitiText} is elevated.`);
  } else {
    pushFinding(findings, "affordability", "A0", "STRONG", `Back-end DTI ${(backendDti * 100).toFixed(1)}%${pitiText} is within policy guidelines.`);
  }

  // 10. Behavioral / device / document metadata checks
  if (metadata.documents) {
    const recentDocs = metadata.documents.filter(d => d.days_before_submission <= 2).length;
    if (recentDocs >= 3) {
      pushFinding(findings, "document_metadata", "A3", "SUSPICIOUS_DOCUMENT_AGES", `${recentDocs} of 4 supporting documents were created within 2 days of submission.`);
    } else if (recentDocs >= 1) {
      pushFinding(findings, "document_metadata", "A1", "RECENT_DOCUMENTS", `${recentDocs} document(s) created shortly before submission.`);
    } else {
      pushFinding(findings, "document_metadata", "A0", "DOCUMENT_AGES_NORMAL", "Supporting documents have plausible ages.");
    }
  }
  if (metadata.ip_risk_score !== undefined) {
    if (metadata.ip_risk_score > 0.7 || metadata.is_tor) {
      pushFinding(findings, "network", "A4", "HIGH_RISK_IP", `IP risk score ${metadata.ip_risk_score}; origin is high-risk or anonymized.`);
    } else if (metadata.ip_risk_score > 0.35 || metadata.is_vpn) {
      pushFinding(findings, "network", "A2", "ANONYMIZED_OR_VPN", "Application originated from VPN or elevated-risk IP.");
    } else {
      pushFinding(findings, "network", "A0", "IP_TRUSTED", "IP origin is low-risk and not anonymized.");
    }
  }
  if (metadata.hour_of_day !== undefined) {
    if (!metadata.is_business_hours) {
      pushFinding(findings, "behavioral", "A2", "OFF_HOURS_SUBMISSION", `Submitted at hour ${metadata.hour_of_day} on day ${metadata.day_of_week}; outside typical business hours.`);
    } else {
      pushFinding(findings, "behavioral", "A0", "BUSINESS_HOURS", "Submitted during normal business hours.");
    }
  }
  if (metadata.fields_copy_pasted !== undefined) {
    if (metadata.fields_copy_pasted >= 4) {
      pushFinding(findings, "behavioral", "A3", "EXCESSIVE_COPY_PASTE", `${metadata.fields_copy_pasted} fields were copy-pasted; inconsistent with natural typing.`);
    } else if (metadata.fields_copy_pasted >= 2) {
      pushFinding(findings, "behavioral", "A1", "SOME_COPY_PASTE", `${metadata.fields_copy_pasted} fields were copy-pasted.`);
    } else {
      pushFinding(findings, "behavioral", "A0", "TYPED_NATURALLY", "Few or no fields copy-pasted.");
    }
  }

  return findings;
}

// ─── GROUND-TRUTH FINDINGS GRAPH ────────────────────────────
// Emits deterministic, citable ground truth for each delta between
// Claimed Truth (C), World Truth (S_t), and Evidence (E).
export function generateGroundTruthFindings(truth, presentation, evidence, corruptionType = "NONE") {
  const findings = [];
  const t = truth.current_state;
  const p = presentation.current_state;

  const w2 = evidence.find(e => e.source === "W2_DOCUMENT")?.fields || {};
  const bank = evidence.find(e => e.source === "BANK_STATEMENT")?.fields || {};
  const employerVerif = evidence.find(e => e.source === "EMPLOYER_VERIFICATION")?.fields || {};

  function cite(source, field, value) {
    return { source, field, value };
  }

  function push(type, targetLayer, claimedValue, trueValue, classification, citations, details) {
    findings.push({
      type,
      target_layer: targetLayer,
      claimed_value: claimedValue,
      true_value: trueValue,
      classification,
      evidence_citations: citations,
      details
    });
  }

  // Income misrepresentation
  if (p.salary !== t.salary) {
    push(
      "INCOME_MISREPRESENTATION",
      "CLAIMED_TRUTH",
      p.salary,
      t.salary,
      p.salary > t.salary * 1.15 ? "A4" : "A1",
      [cite("W2_DOCUMENT", "w2_wages", w2.w2_wages), cite("EMPLOYER_VERIFICATION", "salary", employerVerif.salary), cite("BANK_STATEMENT", "monthly_payroll_deposit", bank.monthly_payroll_deposit)],
      `Application claims ${formatMoney(p.salary)}; verified income is ${formatMoney(t.salary)}.`
    );
  }

  // Asset misrepresentation
  if (p.checking_balance !== t.checking_balance) {
    push(
      "ASSET_MISREPRESENTATION",
      "CLAIMED_TRUTH",
      p.checking_balance,
      t.checking_balance,
      p.checking_balance > t.checking_balance ? "A3" : "A1",
      [cite("BANK_STATEMENT", "checking_balance", bank.checking_balance)],
      `Application checking ${formatMoney(p.checking_balance)} vs bank statement ${formatMoney(t.checking_balance)}.`
    );
  }

  // Employer fabrication
  if (p.employer !== t.employer) {
    push(
      "EMPLOYER_FABRICATION",
      "CLAIMED_TRUTH",
      p.employer,
      t.employer,
      "A4",
      [cite("W2_DOCUMENT", "employer", w2.employer), cite("EMPLOYER_VERIFICATION", "employer", employerVerif.employer)],
      `Application employer ${p.employer} does not match verified employer ${t.employer}.`
    );
  }

  // Liability concealment
  const truthLiabs = truth.events.filter(e => e.type === "LIABILITY_OPENED");
  const presLiabs = presentation.events.filter(e => e.type === "LIABILITY_OPENED");
  if (presLiabs.length < truthLiabs.length || p.monthly_obligations < t.monthly_obligations) {
    push(
      "LIABILITY_CONCEALMENT",
      "CLAIMED_TRUTH",
      p.monthly_obligations,
      t.monthly_obligations,
      "A4",
      [cite("BANK_STATEMENT", "recurring_debits", bank.recurring_debits), cite("CREDIT_BUREAU", "liabilities", truthLiabs.map(l => ({ type: l.type_detail, payment: l.payment })))],
      `Application discloses ${presLiabs.length} liabilities (${formatMoney(p.monthly_obligations)}/mo); truth has ${truthLiabs.length} (${formatMoney(t.monthly_obligations)}/mo).`
    );
  }

  // Synthetic identity / bust-out
  if (corruptionType === "BUST_OUT" || p.synthetic_identity) {
    push(
      "SYNTHETIC_IDENTITY",
      "WORLD",
      null,
      null,
      "A5",
      [cite("BANK_STATEMENT", "checking_balance", bank.checking_balance), cite("CREDIT_BUREAU", "credit_score", bank.credit_score)],
      "Presentation is a synthetic identity with compressed credit-building history."
    );
  }

  if (corruptionType === "OCCUPANCY_MISREPRESENTATION") {
    const occ = presentation.events.find(e => e.type === "OCCUPANCY_DECLARATION");
    push("OCCUPANCY_MISREPRESENTATION", "CLAIMED_TRUTH", "PRIMARY_RESIDENCE", "INVESTMENT", "A4",
      [cite("RENT_VERIFICATION", "payment_history", "CURRENT"), cite("RENT_VERIFICATION", "lease_start", evidence.find(e => e.source === "RENT_VERIFICATION")?.fields?.lease_start)],
      `Applicant declares primary residence ${occ?.subject_property_distance_miles ?? "?"} miles from a lease they retain; property is an investment.`);
  }
  if (corruptionType === "GIFT_FUND_MISREPRESENTATION") {
    push("GIFT_FUND_MISREPRESENTATION", "CLAIMED_TRUTH", p.gift_funds_claimed, 0, "A4",
      [cite("BANK_STATEMENT", "recent_large_deposits", bank.recent_large_deposits)],
      `Down-payment gift of ${formatMoney(p.gift_funds_claimed ?? 0)} is an undisclosed loan from an interested party.`);
  }
  if (corruptionType === "ASSET_SEASONING") {
    push("ASSET_SEASONING", "CLAIMED_TRUTH", p.checking_balance, (p.checking_balance ?? 0) - (p.recently_transferred_funds ?? 0), "A3",
      [cite("BANK_STATEMENT", "recent_large_deposits", bank.recent_large_deposits)],
      `${formatMoney(p.recently_transferred_funds ?? 0)} of stated reserves arrived inside the statement window.`);
  }
  if (corruptionType === "STRAW_BUYER") {
    push("STRAW_BUYER", "CLAIMED_TRUTH", "APPLICANT_OCCUPIES", "THIRD_PARTY_OCCUPIES", "A4",
      [cite("BANK_STATEMENT", "recent_large_deposits", bank.recent_large_deposits)],
      "Third party funded the down payment and will occupy; applicant is a nominee.");
  }
  if (corruptionType === "INCOHERENT" || t.incoherent) {
    push("INCOHERENT_WORLD", "WORLD", null, null, "A3",
      [cite("W2_DOCUMENT", "w2_wages", w2.w2_wages), cite("EMPLOYER_VERIFICATION", "salary", employerVerif.salary)],
      "World truth violates an accounting or timeline invariant; the applicant reports it honestly.");
  }

  // Evidence tampering
  if (corruptionType === "EVIDENCE_TAMPERING") {
    const largeDeposits = bank.recent_large_deposits || [];
    push(
      "EVIDENCE_TAMPERING",
      "EVIDENCE",
      bank.checking_balance,
      t.checking_balance,
      "A4",
      [cite("BANK_STATEMENT", "checking_balance", bank.checking_balance), cite("BANK_STATEMENT", "recent_large_deposits", largeDeposits), cite("W2_DOCUMENT", "w2_wages", w2.w2_wages)],
      "Bank statement appears altered: inflated balance and/or unsupported deposits."
    );
  }

  return findings;
}

// ─── DECISION ENGINE ────────────────────────────────────────
function maxAlignmentLevel(findings) {
  const order = ["A0", "A1", "A2", "A3", "A4", "A5"];
  let max = "A0";
  for (const f of findings) {
    if (order.indexOf(f.level) > order.indexOf(max)) max = f.level;
  }
  return max;
}

function mapFraudRisk(maxLevel) {
  if (maxLevel === "A0") return "NONE";
  if (maxLevel === "A1") return "NONE";
  if (maxLevel === "A2") return "LOW";
  if (maxLevel === "A3") return "MODERATE";
  if (maxLevel === "A4") return "HIGH";
  return "CRITICAL";
}

function mapCoherence(maxLevel) {
  if (maxLevel === "A0") return "COHERENT";
  if (maxLevel === "A1") return "MOSTLY_COHERENT";
  if (maxLevel === "A2") return "PARTIALLY_INCOHERENT";
  if (maxLevel === "A3") return "MATERIALLY_INCOHERENT";
  return "INTENTIONALLY_ADVERSARIAL";
}

function mapCaseCoherenceStatus(maxLevel) {
  if (maxLevel === "A0") return "COHERENT";
  if (maxLevel === "A1" || maxLevel === "A2") return "COHERENT_WITH_EXPLAINABLE_VARIANCES";
  if (maxLevel === "A3") return "INCOHERENT";
  return "FRAUDULENT";
}

export function computeDecision(truth, presentation, evidence, findings, corruptionType, severity, rng = { random: () => Math.random() }, config = {}) {
  const t = truth.current_state;
  const p = presentation.current_state;
  const bank = evidence.find(e => e.source === "BANK_STATEMENT")?.fields || {};
  const w2 = evidence.find(e => e.source === "W2_DOCUMENT")?.fields || {};

  const maxLevel = maxAlignmentLevel(findings);
  const fraudRisk = mapFraudRisk(maxLevel);
  const coherence = mapCoherence(maxLevel);
  const caseCoherenceStatus = mapCaseCoherenceStatus(maxLevel);

  const u = config.underwriting || {};
  const dtiApproveMax = (u.dti?.approve_max ?? 0.38) * 100;
  const dtiManualMax = (u.dti?.manual_review_max ?? 0.47) * 100;
  const creditApproveMin = u.credit_score?.approve_min ?? 640;
  const creditManualMin = u.credit_score?.manual_review_min ?? 600;
  const reservesApproveMin = u.reserves?.approve_min_months ?? 0.25;
  const reservesManualMin = u.reserves?.manual_review_min_months ?? 0.1;
  const tenureApproveMin = u.tenure?.approve_min_months ?? 12;
  const tenureManualMin = u.tenure?.manual_review_min_months ?? 6;

  // Underwrite on VERIFIED income (employer verification == world truth) and the higher of
  // disclosed vs bureau obligations. For clean cases this equals the applicant's own figures.
  const monthlyIncome = t.salary / 12;
  const underwritingObligations = Math.max(p.monthly_obligations ?? 0, t.monthly_obligations ?? 0);
  const backendDti = monthlyIncome > 0 ? (underwritingObligations + (p.monthly_mortgage_payment ?? 0)) / monthlyIncome : (p.backend_dti ?? t.backend_dti ?? p.dti ?? t.dti);
  const reservesMonths = monthlyIncome > 0 ? (bank.checking_balance ?? p.checking_balance) / monthlyIncome : 0;
  let reviewFloor = false; // set by non-material variances: automated approval is not permitted
  const creditScore = t.credit_score;
  const tenureMonths = p.tenure_months ?? t.tenure_months;

  const conditions = [];
  const reasonCodes = [];
  // Codes that apply regardless of which pathway produces the outcome.
  const metaNetwork = findings.some(f => f.dimension === "network" && f.level === "A4");
  const metaDocs = findings.some(f => f.dimension === "document_metadata" && f.level === "A3");
  if (metaNetwork) reasonCodes.push("HIGH_RISK_NETWORK_ORIGIN");
  if (metaDocs) reasonCodes.push("SUSPICIOUS_DOCUMENT_METADATA");
  const TYPE_CODES = {
    BUST_OUT: ["IDENTITY_UNVERIFIABLE", "RAPID_CREDIT_PROFILE_CONSTRUCTION", "UNVERIFIABLE_EMPLOYMENT", "UNVERIFIABLE_INCOME", "MATERIAL_APPLICATION_DISCREPANCY"],
    FABRICATION: ["UNVERIFIABLE_EMPLOYMENT", "UNVERIFIABLE_INCOME", "UNVERIFIABLE_ASSETS", "MATERIAL_APPLICATION_DISCREPANCY"],
    EVIDENCE_TAMPERING: ["POTENTIAL_DOCUMENT_TAMPERING", "UNSOURCED_LARGE_DEPOSIT", "UNVERIFIABLE_ASSETS", "MATERIAL_APPLICATION_DISCREPANCY"],
    INCOHERENT: ["DATA_INTEGRITY_FAILURE", "MATERIAL_APPLICATION_DISCREPANCY"],
    OCCUPANCY_MISREPRESENTATION: ["MATERIAL_APPLICATION_DISCREPANCY"],
    GIFT_FUND_MISREPRESENTATION: ["UNVERIFIABLE_ASSETS", "UNSOURCED_LARGE_DEPOSIT", "MATERIAL_APPLICATION_DISCREPANCY"],
    ASSET_SEASONING: ["UNSOURCED_LARGE_DEPOSIT"],
    STRAW_BUYER: ["MATERIAL_APPLICATION_DISCREPANCY", "UNSOURCED_LARGE_DEPOSIT"]
  };
  if (TYPE_CODES[corruptionType]) reasonCodes.push(...TYPE_CODES[corruptionType]);
  if (p.synthetic_identity && corruptionType !== "BUST_OUT") reasonCodes.push(...TYPE_CODES.BUST_OUT);
  let outcome = "APPROVE";
  let reason = "";
  let difficulty = "BASIC";
  const finish = (overrides = {}) => ({
    alignment_level: maxLevel,
    fraud_risk_level: fraudRisk,
    coherence_status: coherence,
    case_coherence_status: caseCoherenceStatus,
    expected_outcome: outcome,
    difficulty,
    conditions,
    reason,
    reason_codes: [...new Set(reasonCodes)],
    reason_code_catalog_version: REASON_CODE_CATALOG_VERSION,
    ...overrides
  });

  // Fraud / manipulation overrides
  if (corruptionType === "BUST_OUT" || p.synthetic_identity || maxLevel === "A5") {
    outcome = "DECLINE";
    reason = randomChoice([
      "rejected for suspected synthetic identity",
      "rejected for compressed credit history inconsistent with score",
      "rejected for identity that cannot be verified across bureaus"
    ], rng);
    conditions.push("Escalate to fraud investigation unit");
    conditions.push("Request full credit report and identity verification");
    difficulty = "ADVANCED";
    return finish();
  }

  // Incoherent world (A3 negative control) — check before metadata-driven fraud signals
  // so the case is labeled for its physical impossibility rather than fraud artifacts.
  if (corruptionType === "INCOHERENT" || t.incoherent) {
    outcome = "DECLINE";
    reason = randomChoice([
      "rejected for impossible debt-to-income profile",
      "rejected for timeline inconsistency across documents",
      "rejected for W-2 wages exceeding reported gross salary"
    ], rng);
    conditions.push("Review for data entry errors or impossible financial scenario");
    if (!reasonCodes.includes("DATA_INTEGRITY_FAILURE")) reasonCodes.push("DATA_INTEGRITY_FAILURE", "MATERIAL_APPLICATION_DISCREPANCY");
    difficulty = "ADVANCED";
    return finish({
      alignment_level: "A3",
      fraud_risk_level: "MODERATE",
      coherence_status: "MATERIALLY_INCOHERENT",
      case_coherence_status: "INCOHERENT"
    });
  }

  // Metadata-driven fraud signals (network/behavior/docs) can independently trigger decline
  const hasHighRiskNetwork = findings.some(f => f.dimension === "network" && f.level === "A4");
  const hasSuspiciousDocuments = findings.some(f => f.dimension === "document_metadata" && f.level === "A3");
  if (hasHighRiskNetwork || hasSuspiciousDocuments) {
    outcome = "DECLINE";
    reason = randomChoice([
      "rejected for high-risk network origin",
      "rejected for suspicious document metadata",
      "rejected for behavioral and document inconsistencies"
    ], rng);
    conditions.push("Verify applicant identity and device provenance");
    conditions.push("Request original source documents");
    if (corruptionType === "NONE" || !TYPE_CODES[corruptionType]) reasonCodes.push("IDENTITY_UNVERIFIABLE");
    difficulty = "ADVANCED";
    return finish();
  }

  if (corruptionType === "FABRICATION") {
    outcome = "DECLINE";
    reason = randomChoice([
      "rejected for unverifiable income",
      "rejected for unverifiable employment",
      "rejected for suspected fabricated assets"
    ], rng);
    conditions.push("Escalate to fraud investigation unit");
    conditions.push("Request source-of-funds documentation");
    difficulty = "ADVANCED";
    return finish();
  }

  // Concealment
  if (corruptionType === "CONCEALMENT") {
    const hiddenMonthly = (t.monthly_obligations ?? 0) - (p.monthly_obligations ?? 0);
    if (hiddenMonthly >= 100) {
      outcome = "DECLINE";
      reason = randomChoice([
        "rejected for undisclosed debt",
        "rejected for insufficient cash after undisclosed obligations",
        "rejected for excessive DTI after including hidden liabilities",
        "rejected for insufficient cash or undisclosed debt"
      ], rng);
      conditions.push("Explain all undisclosed liabilities");
      conditions.push("Provide updated debt schedule");
      reasonCodes.push("UNDISCLOSED_LIABILITIES", "MATERIAL_APPLICATION_DISCREPANCY");
      if (backendDti * 100 > dtiManualMax) reasonCodes.push("EXCESSIVE_DTI");
      difficulty = "INTERMEDIATE";
      return finish();
    }
    // Non-material gap: re-underwrite on bureau obligations; no automated approval.
    if (hiddenMonthly >= 25) { reasonCodes.push("LIABILITY_VARIANCE_REVIEW"); reviewFloor = true; }
  }

  // Income inflation
  if (corruptionType === "INFLATION") {
    const inflationPct = t.salary > 0 ? (p.salary - t.salary) / t.salary : 0;
    if (inflationPct > 0.15) {
      outcome = "DECLINE";
      reason = randomChoice([
        "rejected for unverifiable income",
        "rejected for inflated salary relative to W-2"
      ], rng);
      conditions.push("Provide additional income documentation");
      reasonCodes.push("UNVERIFIABLE_INCOME", "MATERIAL_APPLICATION_DISCREPANCY");
      difficulty = "INTERMEDIATE";
      return finish();
    }
    // Non-material overstatement: re-underwrite on verified income; no automated approval.
    if (inflationPct > 0.02) { reasonCodes.push("INCOME_VARIANCE_REVIEW"); reviewFloor = true; }
  }

  // Occupancy misrepresentation: primary-residence declaration contradicted by retained lease + distance.
  if (corruptionType === "OCCUPANCY_MISREPRESENTATION") {
    outcome = "DECLINE";
    reason = "rejected for occupancy misrepresentation";
    conditions.push("Obtain occupancy affidavit and verify intent to occupy");
    conditions.push("Re-price as investment property if applicant elects");
    difficulty = "ADVANCED";
    return finish({ alignment_level: "A4", fraud_risk_level: "HIGH", coherence_status: "INTENTIONALLY_ADVERSARIAL", case_coherence_status: "FRAUDULENT" });
  }

  // Gift-fund misrepresentation: down payment is an undisclosed loan / interested-party contribution.
  if (corruptionType === "GIFT_FUND_MISREPRESENTATION") {
    outcome = "DECLINE";
    reason = "rejected for unverifiable gift funds";
    conditions.push("Obtain executed donor letter and donor bank evidence");
    conditions.push("Confirm donor is not a party to the transaction");
    difficulty = "ADVANCED";
    return finish({ alignment_level: "A4", fraud_risk_level: "HIGH", coherence_status: "INTENTIONALLY_ADVERSARIAL", case_coherence_status: "FRAUDULENT" });
  }

  // Straw buyer: third party funds and will occupy; applicant is a nominee.
  if (corruptionType === "STRAW_BUYER") {
    outcome = "DECLINE";
    reason = "rejected for undisclosed third-party interest in the transaction";
    conditions.push("Escalate to fraud investigation unit");
    conditions.push("Verify source of down payment and intended occupant");
    difficulty = "ADVANCED";
    return finish({ alignment_level: "A4", fraud_risk_level: "HIGH", coherence_status: "INTENTIONALLY_ADVERSARIAL", case_coherence_status: "FRAUDULENT" });
  }

  // Asset seasoning: reserves assembled inside the statement window — review, not automatic decline.
  if (corruptionType === "ASSET_SEASONING") {
    reviewFloor = true;
    conditions.push("Source and season all large deposits");
  }

  // Evidence tampering
  if (corruptionType === "EVIDENCE_TAMPERING") {
    outcome = "DECLINE";
    reason = randomChoice([
      "rejected for altered bank statement",
      "rejected for unsupported deposit inconsistent with income",
      "rejected for document-level manipulation"
    ], rng);
    conditions.push("Request original bank statements from institution");
    conditions.push("Verify large deposits with source documentation");
    difficulty = "ADVANCED";
    return finish();
  }

  // Clean / timing drift cases — use holistic underwriting calibrated to generated population
  const dtiPct = backendDti * 100;
  const failDti = dtiPct > dtiManualMax;
  const failCredit = creditScore < creditManualMin;
  const failReserves = reservesMonths < reservesManualMin;
  const failTenure = tenureMonths < tenureManualMin;

  const strongReserves = reservesMonths >= 2.0;
  const lowDti = dtiPct <= 30;
  const moderateDti = dtiPct > 30 && dtiPct <= dtiApproveMax;
  const stableTenure = tenureMonths >= 24;
  const strongCredit = creditScore >= 720;

  if (reviewFloor && dtiPct <= dtiManualMax && creditScore >= creditManualMin && !failReserves && !failTenure) {
    outcome = "MANUAL_REVIEW";
    reason = corruptionType === "ASSET_SEASONING" ? "flagged for unseasoned reserves" : corruptionType === "INFLATION" ? "flagged for income variance; re-underwrite on verified income" : "flagged for liability variance; re-underwrite on bureau obligations";
    if (dtiPct > dtiApproveMax) reasonCodes.push("ELEVATED_DTI");
    if (creditScore < creditApproveMin) reasonCodes.push("MARGINAL_CREDIT_SCORE");
    if (tenureMonths < tenureApproveMin) reasonCodes.push("SHORT_EMPLOYMENT_TENURE");
    if (reservesMonths < reservesApproveMin) reasonCodes.push("INSUFFICIENT_RESERVES");
    conditions.push("Obtain written VOE");
    difficulty = "INTERMEDIATE";
    const floorLevel = corruptionType === "ASSET_SEASONING" ? "A3" : "A1";
    return finish({ alignment_level: maxLevel === "A0" ? floorLevel : maxLevel, fraud_risk_level: corruptionType === "ASSET_SEASONING" ? "MODERATE" : fraudRisk });
  }

  if (dtiPct <= dtiApproveMax && creditScore >= creditApproveMin && reservesMonths >= reservesApproveMin && tenureMonths >= tenureApproveMin) {
    outcome = "APPROVE";
    if (strongReserves && lowDti) {
      reason = "approved with strong reserves";
    } else if (moderateDti) {
      reason = "approved despite moderate DTI because of stable income";
    } else if (stableTenure) {
      reason = "approved for stable employment and verified income";
    } else if (strongCredit) {
      reason = "approved for strong credit profile and acceptable DTI";
    } else {
      reason = "approved with verified income and assets";
    }
    difficulty = "BASIC";
  } else if (dtiPct <= dtiManualMax && creditScore >= creditManualMin && !failReserves && !failTenure) {
    outcome = "MANUAL_REVIEW";
    if (dtiPct > dtiApproveMax) reasonCodes.push("ELEVATED_DTI");
    if (creditScore < creditApproveMin) reasonCodes.push("MARGINAL_CREDIT_SCORE");
    if (tenureMonths < tenureApproveMin) reasonCodes.push("SHORT_EMPLOYMENT_TENURE");
    if (reservesMonths < reservesApproveMin) reasonCodes.push("INSUFFICIENT_RESERVES");
    if ((bank.recent_large_deposits || []).length > 0) reasonCodes.push("UNSOURCED_LARGE_DEPOSIT");
    if (w2.employer && w2.employer !== t.employer) reasonCodes.push("EMPLOYER_NAME_VARIATION");
    if (reasonCodes.length === 0) reasonCodes.push("GENERAL_REVIEW_REQUIRED");
    if (dtiPct > dtiApproveMax) {
      reason = "flagged for elevated DTI";
    } else if (creditScore < creditApproveMin) {
      reason = "flagged for low credit score";
    } else if (tenureMonths < tenureApproveMin) {
      reason = "flagged for insufficient employment history";
    } else if ((bank.recent_large_deposits || []).length > 0) {
      reason = "flagged for unsupported deposit";
    } else if (w2.employer && w2.employer !== t.employer) {
      reason = "flagged for employer-name variation";
    } else {
      reason = "flagged for manual review";
    }
    conditions.push("Verify large deposits");
    conditions.push("Obtain written VOE");
    difficulty = "INTERMEDIATE";
  } else {
    outcome = "DECLINE";
    const reasons = [];
    if (failDti) { reasons.push("excessive DTI"); reasonCodes.push("EXCESSIVE_DTI"); }
    if (failCredit) { reasons.push("low credit score"); reasonCodes.push("INSUFFICIENT_CREDIT_SCORE"); }
    if (failReserves) { reasons.push("insufficient cash"); reasonCodes.push("INSUFFICIENT_RESERVES"); }
    if (failTenure) { reasons.push("insufficient employment history"); reasonCodes.push("LIMITED_EMPLOYMENT_HISTORY"); }
    if (reasons.length === 0) { reasons.push("excessive risk profile"); reasonCodes.push("EXCESSIVE_DTI"); }
    reason = "rejected for " + (reasons.length > 1 ? reasons.slice(0, -1).join(", ") + " and " + reasons.slice(-1) : reasons[0]);
    conditions.push("Reduce DTI or increase income");
    difficulty = severity === "HIGH" ? "ADVANCED" : "INTERMEDIATE";
  }

  return finish();
}
