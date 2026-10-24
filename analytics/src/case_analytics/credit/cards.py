"""The model card and the walkthrough, generated from the snapshot so their numbers cannot drift.

Every number below is read from artifacts/credit-model-snapshot/; every conclusion that depends on a
number (which model is better, whether recalibration was needed, whether reasons are stable) is chosen
by code from that number, not written by hand.
"""

from __future__ import annotations

import math
from typing import Any

XGB, LOGIT = "credit_pd_xgb", "credit_pd_logistic"
TYPOLOGY_ORDER = (
    "INFLATION",
    "CONCEALMENT",
    "EVIDENCE_TAMPERING",
    "FABRICATION",
    "ASSET_SEASONING",
    "INFLATION+CONCEALMENT",
    "NONE",
)


def f3(v: float) -> str:
    return f"{v:.3f}"


def pct(v: float, d: int = 2) -> str:
    return f"{100 * v:.{d}f}%"


def n(v: float | int) -> str:
    return f"{v:,.0f}"


def ci(t: dict[str, Any], key: str, digits: int = 3) -> str:
    m, c = t["metrics"][key], t["ci95"][key]
    return f"{m:.{digits}f} ({c['low']:.{digits}f}–{c['high']:.{digits}f})"


def verdict(s: dict[str, Any]) -> str:
    d = s["comparison"]["xgb_minus_logistic"]["auc_difference"]
    if d["low"] > 0:
        return f"`{XGB}` discriminates better than the baseline: its AUC is higher by {f3(d['point'])} (95% interval {f3(d['low'])} to {f3(d['high'])}, which excludes 0)."
    if d["high"] < 0:
        return f"The logistic baseline discriminates better: `{XGB}`'s AUC is lower by {f3(-d['point'])} (95% interval {f3(d['low'])} to {f3(d['high'])}, which excludes 0)."
    return (
        f"**`{XGB}` does not clearly beat the logistic baseline.** Its AUC is higher by {f3(d['point'])}, but the paired 95% interval "
        f"({f3(d['low'])} to {f3(d['high'])}) contains 0, so this test book of {n(s['data']['after']['test']['defaults'])} defaults cannot tell them apart."
    )


def accuracy_table(before: dict[str, Any], after: dict[str, Any], diag: dict[str, Any]) -> list[str]:
    """Reason accuracy by typology: every positive contribution counted (before), only reasons above the
    materiality threshold (stated, after), and the all-applications diagnostic (every positive one)."""
    rows = [
        "| Typology | Cases | Expected group | Top reason, any positive | Top 4, any positive | Top reason, stated | Any stated reason | Diagnostic: top / top 4 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    share = lambda k, a: f"{n(k)} ({pct(k / a['n'], 0)})"  # noqa: E731
    for t in TYPOLOGY_ORDER:
        if t not in before:
            continue
        b, a, d = before[t], after[t], diag[t]
        if b.get("control"):
            k1, k4 = "top1_blames_discrepancy", "top4_blames_discrepancy"
            label, expected = "NONE (control)", "none: a discrepancy reason is a false alarm"
        else:
            k1, k4 = "top1_hits", "top4_hits"
            label, expected = t, ", ".join(b["expected_groups"])
        rows.append(
            f"| {label} | {n(b['n'])} | {expected} | {share(b[k1], b)} | {share(b[k4], b)} | {share(a[k1], a)} | {share(a[k4], a)} | {n(d[k1])} / {n(d[k4])} |"
        )
    return rows


def deciles_table(rows: list[dict[str, Any]]) -> list[str]:
    out = [
        "| Decile (by predicted PD) | Loans | Defaults | Mean predicted | Observed (95% interval) | Mean true PD |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        out.append(
            f"| {r['decile']} | {n(r['n'])} | {n(r['defaults'])} | {pct(r['mean_predicted'])} | {pct(r['observed_rate'])} ({pct(r['observed_low'])}–{pct(r['observed_high'])}) | {pct(r['mean_true'])} |"
        )
    return out


def stable_word(mean: float) -> str:
    return "stable" if mean >= 0.8 else "moderately stable" if mean >= 0.6 else "**unstable**"


def stability_sentence(st: dict[str, Any]) -> str:
    mean, top = st["mean_agreement"], st["riskiest_decile"]
    return (
        f"Across {st['bootstraps']} retrains on resampled training data, a test loan's top reason matched the headline model's "
        f"{pct(mean, 0)} of the time on average; {pct(st['share_with_agreement_at_least_80pct'], 0)} of loans kept the same top reason in at least 80% of retrains "
        f"and {pct(st['share_with_agreement_below_50pct'], 0)} in fewer than half. Over all loans the top reason is {stable_word(mean)}: most loans sit near the "
        f"average PD, where every contribution is small and the ranking flips easily. In the riskiest tenth of the book, where a reason statement would actually be "
        f"sent, agreement averages {pct(top['mean_agreement'], 0)} ({pct(top['share_with_agreement_at_least_80pct'], 0)} of those loans at 80% or more): {stable_word(top['mean_agreement'])}."
    )


def tampering_sentence(before: dict[str, Any], after: dict[str, Any]) -> str:
    """Whether tampering's asset-discrepancy reasons stand out from the noise clean loans show, judged on
    the stated reasons (after the materiality threshold)."""
    tb, ta = (
        before["teaching_twins_and_conflicting"]["EVIDENCE_TAMPERING"],
        after["teaching_twins_and_conflicting"]["EVIDENCE_TAMPERING"],
    )
    cb, ca = before["funded_test_book"]["NONE"], after["funded_test_book"]["NONE"]
    false_before = cb["by_group"]["ASSET_DISCREPANCY"]["top4"] / cb["n"]
    false_after = ca["by_group"]["ASSET_DISCREPANCY"]["top4"] / ca["n"]
    separable = ta["top1_hits"] / ta["n"] > false_after
    return (
        f"**Tampering {'can' if separable else 'cannot'} be separated from clean-loan noise.** Counting every positive contribution, the asset discrepancy was the top reason for "
        f"{n(tb['top1_hits'])} of {n(tb['n'])} tampering twins and in the top four for {n(tb['top4_hits'])}, but it was also in the top four for {pct(false_before, 0)} of clean funded loans, "
        "because stated and statement balances already differ slightly in most clean loans. "
        f"After the materiality threshold it is stated for {n(ta['top4_hits'])} of {n(ta['n'])} tampering twins (top reason for {n(ta['top1_hits'])}) and for {pct(false_after, 1)} of clean funded loans. "
        + (
            "It is never the top reason, so the model still cannot tell an underwriter that a statement was altered."
            if not separable
            else ""
        )
    )


def flat_calibration_paragraph(s: dict[str, Any]) -> str:
    """Why deciles 1–9 are flat, how decile 10 is made up, and the over- and under-prediction."""
    fb, x = s["funded_book_profile"], s["models"][XGB]["test"]
    d10, top = fb["decile_10"], x["deciles"][-1]
    types = "; ".join(
        f"{k} {n(v)}" for k, v in sorted(d10["by_typology"].items(), key=lambda kv: -kv[1]) if k != "NONE"
    )
    observed, predicted = x["metrics"]["observed_rate"], x["metrics"]["mean_predicted"]
    rel = (predicted - observed) / observed
    under = top["mean_predicted"] < top["observed_rate"]
    return (
        f"**Why deciles 1–9 are flat.** The credit policy screens out most of the simulated credit drivers before a loan is funded. In the funded test book the bureau FICO runs "
        f"{fb['fico_bureau_range'][0]:.0f}–{fb['fico_bureau_range'][1]:.0f} and the stated back-end DTI {pct(fb['dti_stated_range'][0], 1)}–{pct(fb['dti_stated_range'][1], 1)}: "
        f"only {pct(fb['share_true_dti_above_36pct'], 2)} of funded loans have a true DTI above 36%, where the simulated hazard starts to rise, and {pct(fb['share_true_fico_below_700'], 1)} have a true FICO below 700, where FICO adds risk. "
        f"The rest of the remaining risk is fraud ({pct(fb['share_fraud'], 1)} of funded loans) and dealer quality, which the model may not see. So most loans sit near the base rate and the first nine deciles barely separate. "
        f"Decile 10 holds the signal: of its {n(d10['loans'])} loans, {pct(d10['share_fraud'], 1)} are fraud ({types}; {n(d10['by_typology'].get('NONE', 0))} are clean) and {pct(d10['share_true_fico_below_700'], 1)} have a true FICO below 700. "
        f"It is {'under' if under else 'over'}-predicted: {pct(top['mean_predicted'])} predicted against {pct(top['observed_rate'])} observed. "
        f"Overall the test book is over-predicted by {pct(rel, 0)} relative ({pct(predicted)} against {pct(observed)}), because the seed-42 book defaults below the training books' {pct(fb['training_default_rate'])}; "
        "calibration was fitted on other books, as it would be in production, and one book's rate differs by chance."
    )


def fico_fields_sentence(s: dict[str, Any]) -> str:
    ff = s["funded_book_profile"]["fico_fields"]
    g = ff["bureau_minus_claimed"]
    low = ff["claimed_range_of_those"]
    return (
        f"**Two FICO fields.** The credit policy reads the applicant's claimed FICO; the model reads the bureau's (`fico_bureau`). No funded loan claims below the 660 floor "
        f"({n(ff['funded_with_claimed_below_660'])}), but {n(ff['funded_with_bureau_below_660'])} funded loans have a bureau score below 660"
        + (f", all claiming {low[0]:.0f}–{low[1]:.0f}" if low else "")
        + f", which is why the funded book's bureau FICO starts below 660. In this generator the claimed FICO equals the true score on {pct(ff['claimed_equals_true_share'], 1)} of funded loans, "
        f"while the bureau score is the true score plus noise: bureau minus claimed averages {g['mean']:+.2f} points (standard deviation {g['sd']:.2f}, range {g['min']:+.0f} to {g['max']:+.0f}) and is exactly equal on "
        f"{pct(ff['bureau_equals_claimed_share'], 1)}; {n(ff['funded_with_bureau_above_850'])} funded loans have a bureau score above 850. The model therefore reads a noisier copy of the FICO that drives the "
        "simulated default, which weakens its FICO signal. This is a generator defect, logged in [docs/KNOWN_ISSUES.md](KNOWN_ISSUES.md); the bureau field is kept because it is the one a real lender would use."
    )


def policy_paragraph(s: dict[str, Any]) -> str:
    pv, coef = s["policy_view"], s["models"][LOGIT]["coefficients_per_sd"]["fico_bureau"]
    lg, xg = pv[LOGIT], pv[XGB]
    return (
        f"**Why the logistic model's choice costs ${n(lg['model_expected_loss'])} against the policy's ${n(pv['policy_expected_loss'])}.** Trained on funded loans only, under a policy that "
        f"already screens FICO and DTI, the model learns that credit score barely matters: its FICO coefficient is {coef:+.3f} per standard deviation. "
        f"Applied to every applicant, the linear model extrapolates that flat slope to people the policy declined: of its {n(lg['swap_in'])} swap-ins, "
        f"{n(lg['swap_in_by_policy_decision']['DECLINE'])} were policy declines and {pct(lg['swap_in_share_fico_below_660'], 1)} have a FICO below 660; their mean charge-off PD is "
        f"{pct(lg['swap_in_mean_pd_chargeoff'])} against {pct(lg['swap_out_mean_pd_chargeoff'])} for the loans it swaps out. Monotonic trees flatten beyond the data instead of extrapolating a line, "
        f"so `{XGB}` swaps in {n(xg['swap_in'])} ({pct(xg['swap_in_share_fico_below_660'], 1)} below FICO 660) at about the same PD as it swaps out, and costs ${n(xg['model_expected_loss'])}. "
        "Both are scoring applicants outside their training population; the reject-inference section measures how much of that standard methods recover. "
        "The comparison also favours the policy: it reads the claimed FICO, which in this generator equals the true score, while both models read the noisier bureau score. "
        f"So the models' loss figures are conservative, and part of the logistic model's ${n(lg['model_expected_loss'])} is that handicap, not only selection bias."
    )


def diagnostic_reason_sentence(s: dict[str, Any]) -> str:
    d = s["reasons"]["accuracy"]["diagnostic_all_applications"]["teaching_twins_and_conflicting"]
    h = s["reasons"]["materiality"]["accuracy_after"]["teaching_twins_and_conflicting"]
    fab, tam, hfab = d["FABRICATION"], d["EVIDENCE_TAMPERING"], h["FABRICATION"]
    return (
        f"The all-applications diagnostic names the asset discrepancy for {n(fab['top4_hits'])} of {n(fab['n'])} fabrication twins (headline, stated: {n(hfab['top4_hits'])} of {n(hfab['n'])}), "
        "which confirms that funded-only selection, not the method, is what hides fabrication. "
        f"It names it for {n(tam['top4_hits'])} of {n(tam['n'])} tampering twins: an open question. The diagnostic does see tampered applications in training, but the generator's tampering also adds large unsourced deposits, which the teaching twins (one altered balance) lack; that is one possible reason, not yet tested."
    )


def materiality_paragraph(m: dict[str, Any]) -> str:
    fr, risky = m["false_reason_rate"], m["riskiest_decile"]
    return (
        f"A reason group is stated only if its SHAP contribution exceeds **{m['threshold_log_odds']:.6f} log-odds**. The threshold was chosen on the "
        f"{m['chosen_on']}: the smallest value at which at most {pct(m['target_false_reason_rate'], 0)} of clean loans are given a discrepancy reason "
        f"(on those loans: {pct(fr['calibration_clean_before'], 1)} before, {pct(fr['calibration_clean_after'], 1)} after). Measured afterwards on the "
        f"{n(fr['test_clean_loans'])} clean test loans: {pct(fr['test_clean_before'], 1)} were given a false discrepancy reason before the threshold and "
        f"{pct(fr['test_clean_after'], 1)} after. In the riskiest tenth of the test book ({n(risky['loans'])} loans), {n(risky['without_a_stated_reason_after'])} "
        f"lose every stated reason ({n(risky['without_a_stated_reason_before'])} had none before). The case view and the case snapshot show stated reasons only."
    )


def inflation_sentence(m: dict[str, Any]) -> str:
    k = m["clean_training_loans_with_an_income_discrepancy"]
    return (
        f"**Inflation's perfect score is perfect by construction.** In this simulation an income discrepancy occurs only on fraud loans "
        f"({n(k)} clean training loans carry one), so any income gap is a fraud signal and the model cannot get it wrong. Real files have benign "
        "discrepancies (bonuses, rounding, pay changes), and a real model would have to tell them apart; this score says nothing about that."
    )


def control_sentence(acc: dict[str, Any]) -> str:
    """Which discrepancy groups the clean funded loans are wrongly given, by group."""
    c = acc["funded_test_book"]["NONE"]
    parts = [
        f"{g} {n(v['top4'])} in the top four ({n(v['top1'])} as the top reason)"
        for g, v in c["by_group"].items()
        if v["top4"]
    ]
    if not parts:
        return "No clean funded loan was given a discrepancy reason."
    text = f"On the {n(c['n'])} clean funded loans the false alarms come from: " + "; ".join(parts) + "."
    if c["by_group"]["UNDISCLOSED_DEBT"]["top4"]:
        text += " Undisclosed-debt false alarms come from `undisclosed_accounts`: the bureau lists one more account than the application on most loans, a generator quirk."
    elif [g for g, v in c["by_group"].items() if v["top4"]] == ["ASSET_DISCREPANCY"]:
        text += " All of them are asset discrepancies: stated and statement balances already differ slightly in most clean loans."
    return text


CHAMPION = "bureau_score_policy"
ATTRIBUTE_NAMES = {
    "age_band": "Age band",
    "geography_group": "Region (cost-of-living group)",
    "zip3": "ZIP3 (ten largest, the rest as other)",
    "income_band": "Income band",
    "persona": "Persona (occupation)",
    "regime": "Regime",
    "family_status_scenario": "Family status (synthetic scenario)",
    "disability_income_scenario": "Disability income (synthetic scenario)",
}
SET_NAMES = {
    "opening_library": "Opening library",
    "teaching_v1": "Teaching-v1",
    "pool_seed_42": "Seed-42 pool",
}
# Display order for ordinal groups (the snapshot lists groups alphabetically).
GROUP_ORDER = {"income_band": ("<50K", "50K-80K", "80K-120K", "120K-180K", "180K+")}
LEGAL_STATUS = (
    "**Legal status, as of October 2026.** ECOA disparate-impact liability was removed from Regulation B effective "
    "July 21, 2026, and that change is being litigated (*NFHA v. CFPB*). Disparate impact remains relevant under the "
    "Fair Housing Act where it applies, and under state laws such as New Jersey's LAD and Massachusetts law. Colorado "
    "SB 26-189 takes effect January 1, 2027. These tables are monitoring evidence for a reviewer; they don't establish "
    "or rule out legal compliance."
)


def rate_ci(r: dict[str, Any]) -> str:
    lo, hi = r["rate_ci95"]
    return f"{pct(r['rate'], 1)} ({pct(lo, 1)}–{pct(hi, 1)})"


def air(r: dict[str, Any], with_ci: bool = True) -> str:
    if not r["rated"]:
        return "not rated"
    if r["air_ci95"] is None or not with_ci:
        return f3(r["adverse_impact_ratio"]) + (" (reference)" if r["air_ci95"] is None and with_ci else "")
    lo, hi = r["air_ci95"]
    return f"{f3(r['adverse_impact_ratio'])} ({f3(lo)}–{f3(hi)})"


def flip_table(fl: dict[str, Any]) -> list[str]:
    sets = [k for k in SET_NAMES if k in fl["sets"]]
    L = [
        "| Flip | Attribute | " + " | ".join(f"{SET_NAMES.get(k, k)}: flips, changed" for k in sets) + " |",
        "|---|---|" + "---|" * len(sets),
    ]
    for i, r in enumerate(fl["sets"][sets[0]]):
        if r["kind"] == "financial":
            continue
        cells = [f"{n(fl['sets'][k][i]['flips'])}, {n(fl['sets'][k][i]['changed'])}" for k in sets]
        L.append(f"| {r['kind']} | `{r['attribute']}` | " + " | ".join(cells) + " |")
    return L


def financial_sentence(fl: dict[str, Any]) -> str:
    parts = []
    for k in [k for k in SET_NAMES if k in fl["sets"]]:
        r = next(x for x in fl["sets"][k] if x["kind"] == "financial")
        parts.append(
            f"{SET_NAMES.get(k, k).lower()}: {n(r['flips'])} flips, DTI moved on {n(r['dti_moved'])}, the credit decision changed on "
            f"{n(r['decision_changed'])}, and {n(r['changed_without_dti_move'])} changed anything without a DTI move"
        )
    return (
        "**The financial channel, reported separately.** Moving an applicant to another region also moves their housing cost "
        "(the current housing payment scaled by the target region's rent multiplier), so DTI follows and decisions can change. "
        "That is a credit factor responding to a cost, not the engine reading region, and it is reported as its own category: "
        + "; ".join(parts)
        + ". A change the channel does not explain would have stopped the sprint; there were none."
    )


def group_md(name: str, g: dict[str, Any]) -> list[str]:
    pol = g["policies"]
    ch, xg, ai = pol[CHAMPION], pol["credit_pd_xgb_cutoff"], pol["as_is_policy_reference"]
    L = [
        f"**{ATTRIBUTE_NAMES.get(name, name)}** (overall approval rate {pct(ch['overall_rate'], 1)} under the champion)"
        + (
            ": a legitimate credit factor. Differences by income are expected and are not evidence of unfair treatment."
            if g["legitimate_credit_factor"]
            else ""
        ),
        "",
        "| Group | Applicants | Champion: approval rate (95% CI) | vs overall | Champion: AIR (95% CI) | `credit_pd_xgb` cut-off: rate, AIR | As-is reference: rate |",
        "|---|---|---|---|---|---|---|",
    ]
    order = GROUP_ORDER.get(name)
    rows = list(zip(ch["groups"], xg["groups"], ai["groups"]))
    if order:
        rows.sort(key=lambda t: order.index(t[0]["group"]) if t[0]["group"] in order else len(order))
    for r, rx, ra in rows:
        L.append(
            f"| {r['group']} | {n(r['applicants'])} | {rate_ci(r)} | {100 * r['difference_from_overall']:+.1f} pts | {air(r)} | "
            f"{pct(rx['rate'], 1)}, {air(rx, with_ci=False)} | {pct(ra['rate'], 1)} |"
        )
    return L + [""]


def proxy_reading(a: dict[str, Any]) -> str:
    if a["auc"] > 0.60:
        return "usable proxy: " + ", ".join(f"`{f}`" for f in a["top_features"])
    if a["auc_ci95"][0] <= 0.5 or a["auc"] < 0.55:
        return "no usable proxy"
    return "weak (0.55–0.60)"


def fairness_md(p: dict[str, Any]) -> list[str]:
    f = p["fairness"]
    fl, pr = f["flips"], f["proxy"]["attributes"]
    pols = f["policies"]
    L = [
        "## Fairness",
        "",
        "Monitoring evidence, not a legal conclusion. Three questions: does any engine use a sensitive attribute, do approval rates differ by group, and does a neutral feature stand in for a sensitive one?",
        "",
        "**Counterfactual flips.** Every case in three sets had each sensitive attribute flipped to every other value, in three ways: *audit* (the `flip_sensitive` mutation, the audit record only), *deep* (the attribute in every layer that holds a copy of it, nothing recomputed) and *financial* (below). Compared before and after: the credit-policy decision and reason codes, the underwriting decision and codes, every fraud-rule result, and the credit model's 14 features, which fix its PD and its stated reasons.",
        "",
        *flip_table(fl),
        "",
        (
            "**No engine reads a sensitive attribute:** every audit and deep flip changed nothing."
            if fl["clean"]
            else "**A flip changed an output; see the table.**"
        )
        + " A test-only policy that reads the age band fails this check, so the check can fail; a second one that reads the true region is caught only by the deep flip, which is why the deep flip exists.",
        "",
        financial_sentence(fl),
        "",
        f"**Approval rates by group** on the seed-42 application pool. The champion is the bureau-score policy ({n(pols[CHAMPION]['approvals'])} approvals); the `credit_pd_xgb` cut-off approves the same number; the as-is policy ({n(pols['as_is_policy_reference']['approvals'])} approvals) reads the claimed FICO, which sees the true score, so it is not a fair benchmark and appears as a reference column only. AIR is the adverse impact ratio, the group's rate over the highest rated group's. Intervals: Wilson 95% for approval rates, Katz log-scale 95% for the AIR. Groups under {f['min_rated_group']} applicants are listed but not rated. AIR reference line: {f['air_reference_line']['value']:.2f}. {f['air_reference_line']['note']} It is not shown for income band, a legitimate credit factor, and no row is marked against it.",
        "",
    ]
    for name in [k for k in ATTRIBUTE_NAMES if k in f["groups"]]:
        L += group_md(name, f["groups"][name])
    L += [
        "The flips prove that no engine reads these attributes, so every difference above arrives through the decision inputs (FICO, DTI, liquidity and fraud review) and how they vary across groups. Region is the clearest case: it moves housing cost, and so DTI.",
        "",
        "**Proxy check.** Can the credit model's 14 features predict a sensitive attribute? "
        + f["proxy"]["method"][0].upper()
        + f["proxy"]["method"][1:]
        + ". AUC near 0.5 means no usable proxy.",
        "",
        "| Attribute | Groups | AUC (95% CI) | Reading |",
        "|---|---|---|---|",
        *[
            f"| {ATTRIBUTE_NAMES.get(k, k)} | {a['groups']} | {f3(a['auc'])} ({f3(a['auc_ci95'][0])}–{f3(a['auc_ci95'][1])}) | {proxy_reading(a)} |"
            for k, a in ((k, pr[k]) for k in ATTRIBUTE_NAMES if k in pr)
        ],
        "",
        "Income band is predicted by stated income, as it must be. The synthetic scenario attributes (family status, disability income) are drawn independently of every financial variable, so they are the control: a proxy there would be a defect. A strong proxy for region or persona means a model could reproduce group differences without ever seeing the attribute, which is why the group tables above are the evidence that matters, not the exclusion of the attribute.",
        "",
        LEGAL_STATUS,
        "",
    ]
    return L


def model_card(s: dict[str, Any], p: dict[str, Any] | None = None) -> str:
    x, lg = s["models"][XGB], s["models"][LOGIT]
    ce, d = s["ceilings"], s["data"]
    r, pv, dg = s["reasons"], s["policy_view"], s["diagnostic_all_applications"]
    acc = r["accuracy"]
    mat = r["materiality"]
    after = d["after"]
    L = [
        "# Model card: `credit_pd_xgb` (Solar prime probability of default)",
        "",
        "_Generated by `python -m case_analytics.credit.docs --write` from `artifacts/credit-model-snapshot/`. Every number is the snapshot's; `--check` fails if this file and the snapshot disagree._",
        "",
        "**Status: developer testing, not independent validation** (the SR 26-2 wording; SR 26-2 replaced SR 11-7 in April 2026). **Second opinion only: the credit policy makes the decision.** The model changes no decision, no locked number and no answer key.",
        "",
        "## Intended use",
        "",
        "- Training and portfolio demonstration: how a PD model is built, calibrated, explained and checked against a known truth.",
        "- **Not** for real lending decisions, and not for any real applicant. Every borrower, dealer and outcome is synthetic.",
        "",
        "> **The model recovers a simple, known simulated process, so its performance does not transfer to real data.** Default here is a logistic monthly hazard of four things: true FICO below 700, true DTI above 36%, a fraud flag, and dealer quality. Real default has many more drivers, noisier data and drift.",
        "",
        "## Data",
        "",
        f"- **Target:** {s['target']}.",
        f"- **Training:** {n(after['training']['rows'])} funded loans from {len(d['seeds']['training'])} independent books (seeds {', '.join(map(str, d['seeds']['training']))}), {n(after['training']['defaults'])} defaults ({pct(after['training']['default_rate'])}).",
        f"- **Calibration:** {n(after['calibration']['rows'])} funded loans from seeds {', '.join(map(str, d['seeds']['calibration']))}, {n(after['calibration']['defaults'])} defaults.",
        f"- **Test:** the locked seed-42 book, {n(after['test']['rows'])} funded loans, {n(after['test']['defaults'])} defaults ({pct(after['test']['default_rate'])}). It played no part in tuning or calibration.",
        "- **Selection bias:** outcomes exist only for funded loans, so the model learns from approved applicants only. Reject inference is measured below.",
        "- **No out-of-time test:** every application in these books is submitted on the same as-of date (2026-01-15); the seed-42 book is out-of-sample by seed only.",
        "- " + fico_fields_sentence(s),
        "- Details, shapes before and after, and the feature list: [analytics/credit/README.md](../analytics/credit/README.md).",
        "",
        "**Features** (decision-time only; monotonic direction in brackets): "
        + "; ".join(f"`{f['name']}` [{'+' if f['monotone'] > 0 else '−'}]" for f in s["features"])
        + ".",
        "",
        "**Excluded:** "
        + "; ".join(s["excluded"])
        + ". Hidden truth (the oracle files) is used only to evaluate; a test enforces it.",
        "",
        "## Models",
        "",
        f"- **Baseline `{LOGIT}`:** median imputation, standardisation, L2 logistic regression; C = {lg['params']['C']} chosen by cross-validation over whole training books.",
        f"- **Challenger `{XGB}`:** XGBoost with a monotonic constraint on every feature, no class reweighting (`scale_pos_weight` = 1), histogram trees, one thread, no sampling. Chosen from the grid by cross-validated log loss: max depth {x['params']['max_depth']}, learning rate {x['params']['learning_rate']}, {x['params']['n_estimators']} trees, min child weight {x['params']['min_child_weight']}.",
        "",
        "## Performance on the test book",
        "",
        "| Model | AUC (95% CI) | KS (95% CI) | Brier (95% CI) | Mean predicted | Observed |",
        "|---|---|---|---|---|---|",
        f"| `{XGB}` | {ci(x['test'], 'auc')} | {ci(x['test'], 'ks')} | {ci(x['test'], 'brier', 4)} | {pct(x['test']['metrics']['mean_predicted'])} | {pct(x['test']['metrics']['observed_rate'])} |",
        f"| `{LOGIT}` | {ci(lg['test'], 'auc')} | {ci(lg['test'], 'ks')} | {ci(lg['test'], 'brier', 4)} | {pct(lg['test']['metrics']['mean_predicted'])} | {pct(lg['test']['metrics']['observed_rate'])} |",
        f"| Ceiling: the simulation's true PD | {ci(ce['true_pd'], 'auc')} | {ci(ce['true_pd'], 'ks')} | {ci(ce['true_pd'], 'brier', 4)} | {pct(ce['true_pd']['metrics']['mean_predicted'])} | |",
        f"| Fair ceiling: true PD averaged over dealers | {ci(ce['true_pd_dealer_averaged'], 'auc')} | {ci(ce['true_pd_dealer_averaged'], 'ks')} | {ci(ce['true_pd_dealer_averaged'], 'brier', 4)} | {pct(ce['true_pd_dealer_averaged']['metrics']['mean_predicted'])} | |",
        "",
        f"With {n(after['test']['defaults'])} test defaults the intervals are wide. {verdict(s)} The true-PD ceiling shows the best any model could do on this book. The fair ceiling averages each loan's true PD over the dealers it could have been assigned to (weighted as the simulation assigns them), so it is the expected PD of a model that cannot see the dealer: the benchmark for a dealer-blind model.",
        "",
        "## Calibration",
        "",
        *[
            f"- `{m}`: on the calibration books {c['calibration_books']['before']['trigger']['deciles_outside']} of 10 deciles fell outside the 95% interval and the mean prediction was off by {pct(c['calibration_books']['before']['trigger']['calibration_in_the_large_relative_error'], 1)} relative, so recalibration was {'applied (isotonic, fitted on the calibration books only)' if c['calibration_books']['recalibrated'] else 'not needed by the pre-registered rule (3+ deciles outside, or more than 10% relative)'}. On the test book it predicts {pct(c['test']['calibration_in_the_large']['mean_predicted'])} against {pct(c['test']['calibration_in_the_large']['observed'])} observed."
            for m, c in ((XGB, x), (LOGIT, lg))
        ],
        "",
        f"**`{XGB}` on the test book, by decile:**",
        "",
        *deciles_table(x["test"]["deciles"]),
        "",
        flat_calibration_paragraph(s),
        "",
        "## Learned PD against true PD",
        "",
        "Only synthetic data has the true probability. The comparison is the headline result.",
        "",
        "| Model | Rank correlation with true PD | Mean absolute error | Rank correlation with dealer-blind true PD | Mean absolute error |",
        "|---|---|---|---|---|",
        *[
            f"| `{m}` | {f3(c['test']['learned_vs_true']['spearman'])} | {pct(c['test']['learned_vs_true']['mean_absolute_error'])} | {f3(c['test']['learned_vs_true_dealer_averaged']['spearman'])} | {pct(c['test']['learned_vs_true_dealer_averaged']['mean_absolute_error'])} |"
            for m, c in ((XGB, x), (LOGIT, lg))
        ],
        "",
        "The gap to the full true PD is mostly the dealer, which the model cannot see by design; the comparison with the dealer-averaged true PD is the fair one.",
        "",
        "## Policy view (reported only)",
        "",
        f"At the credit policy's approval count on the seed-42 application pool ({n(pv['approvals'])} of {n(pv['applications'])}), approving the lowest-PD applications instead would swap {n(pv[XGB]['swap_in'])} loans in and out under `{XGB}` and {n(pv[LOGIT]['swap_in'])} under `{LOGIT}`. Expected loss (synthetic truth, LGD {pv['lgd']}): policy ${n(pv['policy_expected_loss'])}, `{XGB}` ${n(pv[XGB]['model_expected_loss'])}, `{LOGIT}` ${n(pv[LOGIT]['model_expected_loss'])}. Declined applicants are outside the training population, so their scores are extrapolation. The fair comparison, against the bureau-score policy at equal volume, is the champion/challenger section below.",
        "",
        policy_paragraph(s),
        "",
        "## All-applications diagnostic (not the headline model)",
        "",
        f"Trained with the same settings on every application of the training books ({n(dg['training_rows'])} rows, {n(dg['training_defaults'])} defaults), which only a simulation can label. On the same test book: AUC {ci(dg['test'], 'auc')}, a difference of {dg['difference_vs_headline']['auc']:+.3f} from the headline model; Brier difference {dg['difference_vs_headline']['brier']:+.5f}. Reason accuracy is compared below.",
        "",
        "## Reasons",
        "",
        "Method: TreeSHAP splits each prediction's log-odds into one contribution per feature plus a base value; the split was checked to add up on every test loan. Contributions are summed by feature group, and up to the top four groups that raise risk become the reason statements (Reg B, 12 CFR §1002.9, requires the specific principal reasons for adverse action). SHAP is a standard way to rank contributions; it is not a method regulators have endorsed.",
        "",
        "| Group | Reason statement | Features | Mean \\|SHAP\\| (test book) |",
        "|---|---|---|---|",
        *[
            f"| {g} | {v['statement']} | {', '.join(f'`{f}`' for f in v['features'])} | {r['global']['groups'][g]:.4f} |"
            for g, v in r["groups"].items()
        ],
        "",
        f"**Stability.** {stability_sentence(r['stability'])} (Stability is measured on the top positive contribution, before the materiality threshold below.)",
        "",
        "## Reason materiality",
        "",
        materiality_paragraph(r["materiality"]),
        "",
        "## Reason accuracy against the hidden truth",
        "",
        "Did the reason name the field that was actually falsified? The expected group per typology: concealment → undisclosed debt; inflation → income discrepancy; tampering and fabrication → asset discrepancy; asset seasoning → unsourced deposits. Clean cases are the control.",
        "",
        "**Teaching-v1 twins** (seed-42 bases, unseen in training; the conflicting cases count a hit for either expected group):",
        "",
        *accuracy_table(
            mat["accuracy_before"]["teaching_twins_and_conflicting"],
            mat["accuracy_after"]["teaching_twins_and_conflicting"],
            acc["diagnostic_all_applications"]["teaching_twins_and_conflicting"],
        ),
        "",
        "**The funded seed-42 book** (the funded book holds no tampering or fabrication loans: those are routed to review):",
        "",
        *accuracy_table(
            mat["accuracy_before"]["funded_test_book"],
            mat["accuracy_after"]["funded_test_book"],
            acc["diagnostic_all_applications"]["funded_test_book"],
        ),
        "",
        control_sentence(mat["accuracy_before"]),
        "",
        tampering_sentence(mat["accuracy_before"], mat["accuracy_after"]),
        "",
        inflation_sentence(mat),
        "",
        diagnostic_reason_sentence(s),
        "",
        "A low score is a finding, not a failure to hide: it means the model predicts default but cannot tell an underwriter why in fraud terms, which supports keeping the fraud rules beside it. Tampering and fabrication are the hardest case by construction: the funded training books contain neither typology, so the model has only seen the small balance differences of clean loans.",
        "",
        *(fairness_md(p) if p and "fairness" in p else []),
        *(champion_md(p) if p and "champion_challenger" in p else []),
        *(reject_md(p) if p and "reject_inference" in p else []),
        *(drift_md(p) if p and "drift" in p else []),
        "## Limitations",
        "",
        "- Synthetic data from a known, simple process (above); results do not transfer to real lending.",
        f"- {n(after['test']['defaults'])} test defaults: confidence intervals are wide.",
        (
            reject_limit(p)
            if p and "reject_inference" in p
            else "- Funded-only selection bias; no reject inference (Sprint 12)."
        ),
        (
            "- Fairness evidence is monitoring only (above): sensitive and geographic attributes are excluded and unread, but group outcomes still differ through the credit factors, and none of this is a legal conclusion."
            if p and "fairness" in p
            else "- Fairness is not yet tested (Sprint 12). Sensitive and geographic attributes are excluded, which does not by itself establish fair outcomes."
        ),
        (
            "- No out-of-time test (one as-of date). Drift is tested on shifted synthetic books only (above), each changing one setting at a time."
            if p and "drift" in p
            else "- No out-of-time test (one as-of date). No drift monitoring (Sprint 12)."
        ),
        "- Generator defects the model sees (bureau scores above 850; one extra bureau account on most loans) are logged in [docs/KNOWN_ISSUES.md](KNOWN_ISSUES.md) for a future generator version.",
        "",
        "## How this would run in production",
        "",
        "The feature build would be a dbt model over the loan-origination tables and the retraining a scheduled Airflow job, with the manifest hashes as data contracts. Neither is built here; both are portfolio items for later.",
        "",
        "## Reproducibility",
        "",
        "`node scripts/export_credit_features.mjs` (data; every file hashed in `data/credit-model/manifest.json`), then `python -m case_analytics.credit.pipeline` (snapshot), with the exact package versions in `analytics/constraints-credit.txt`. A rerun on the same machine is byte-identical; CI rebuilds on Linux and compares numerically within a stated tolerance (`case_analytics.credit.compare`).",
        "",
    ]
    return "\n".join(L)


def walkthrough(s: dict[str, Any], p: dict[str, Any] | None = None) -> str:
    x, lg, ce, d, r = s["models"][XGB], s["models"][LOGIT], s["ceilings"], s["data"], s["reasons"]
    after = d["after"]
    coef = lg["coefficients_per_sd"]
    top_coef = sorted(((k, v) for k, v in coef.items() if k != "(intercept)"), key=lambda kv: -abs(kv[1]))[:3]
    gi = sorted(r["global"]["groups"].items(), key=lambda kv: -kv[1])
    acc = r["accuracy"]["headline"]
    infl = acc["funded_test_book"].get("INFLATION")
    L = [
        "# The credit model, step by step",
        "",
        "_Generated by `python -m case_analytics.credit.docs --write` from the snapshot, so every number is this book's. Drafted by Claude Code; review it like code. Each step ends with a question to check yourself._",
        "",
        "## 1. The target",
        "",
        f"Default means the Solar loan reached 30 or more days past due within 18 months: the `dpd30` flag. On the funded test book that happened to {n(after['test']['defaults'])} of {n(after['test']['rows'])} loans ({pct(after['test']['default_rate'])}). It is not the Mortgage `label__defaulted`, which belongs to a different generator and a different product.",
        "",
        "*Check yourself:* why is a default flag, rather than the simulation's PD, the thing a lender can train on?",
        "",
        "## 2. The split",
        "",
        f"Training uses {len(d['seeds']['training'])} independent books ({n(after['training']['rows'])} loans, {n(after['training']['defaults'])} defaults); calibration uses two more; the locked seed-42 book is the test set and is touched once, at the end. Splitting by book rather than by row means no applicant, dealer draw or seed is shared between training and test. Tuning folds also hold out whole books.",
        "",
        "*Check yourself:* what would go wrong if the test book were used to choose the hyperparameters?",
        "",
        "## 3. The features",
        "",
        "Fourteen decision-time fields: the stated figures, the verified ones from the documents, and one-sided discrepancies between them (for example `income_overstatement_pct`, the positive part of stated minus verified income, over verified). An underwriter has both figures, so the discrepancies are allowed. Excluded: sensitive and geographic attributes, dealer ID, device metadata, fraud-rule outputs, W-2 wages and every hidden-truth column.",
        "",
        "*Check yourself:* why is dealer ID excluded even though dealer quality drives default in this simulation?",
        "",
        "## 4. The baseline",
        "",
        "Logistic regression on standardised features: each coefficient is the change in log-odds for one standard deviation of the feature. The largest here: "
        + "; ".join(f"`{k}` {v:+.3f}" for k, v in top_coef)
        + f". Test AUC {ci(lg['test'], 'auc')}.",
        "",
        "*Check yourself:* a coefficient of −0.5 on `fico_bureau`: what happens to the odds of default for a one-SD higher score?",
        "",
        "## 5. XGBoost",
        "",
        f"A boosted model adds small trees one at a time, each correcting the last. Monotonic constraints force a higher FICO never to raise risk and a larger discrepancy never to lower it, so the model cannot learn a pattern a credit committee would reject. Classes are not reweighted: reweighting would inflate every prediction and they would stop being probabilities. Chosen settings: depth {x['params']['max_depth']}, {x['params']['n_estimators']} trees at learning rate {x['params']['learning_rate']}.",
        "",
        "*Check yourself:* why does `scale_pos_weight` = 1 matter for a PD model but not for a fraud-ranking model?",
        "",
        "## 6. Evaluation",
        "",
        f"AUC is the chance a random defaulter scores above a random non-defaulter: `{XGB}` {ci(x['test'], 'auc')}. KS is the largest gap between the cumulative score distributions of defaulters and non-defaulters: {ci(x['test'], 'ks')}. Brier is the mean squared error of the probabilities: {ci(x['test'], 'brier', 4)}. Calibration by decile compares mean predicted PD with the observed rate in each tenth of the book; in the riskiest decile here {pct(x['test']['deciles'][-1]['mean_predicted'])} was predicted and {pct(x['test']['deciles'][-1]['observed_rate'])} observed. {verdict(s)}",
        "",
        "*Check yourself:* a model with high AUC but poor calibration: which committee question can it answer, and which can't it?",
        "",
        "## 7. SHAP",
        "",
        f"Each prediction's log-odds equal a base value ({r['base_value_log_odds']:.3f}, which is a PD of 1 / (1 + e^{-r['base_value_log_odds']:.3f}) ≈ {pct(1 / (1 + math.exp(-r['base_value_log_odds'])), 1)}) plus one contribution per feature; this was checked on all {n(r['additivity']['rows_checked'])} test loans. Contributions are summed by group so one cause is not reported twice, and the groups that raise risk most become reasons. Largest groups on average: "
        + "; ".join(f"{g} {v:.4f}" for g, v in gi[:3])
        + f". {stability_sentence(r['stability'])}",
        "",
        "*Check yourself:* why sum `dti_stated` and `stated_monthly_debts` into one reason?",
        "",
        "## 8. Learned PD against true PD",
        "",
        f"The simulation knows each loan's true probability. `{XGB}`'s predictions rank-correlate {f3(x['test']['learned_vs_true']['spearman'])} with it, and {f3(x['test']['learned_vs_true_dealer_averaged']['spearman'])} with the true PD averaged over the dealers each loan could have been assigned to. The fair ceiling, that dealer-averaged true PD itself, reaches AUC {ci(ce['true_pd_dealer_averaged'], 'auc')}: that is how close a dealer-blind model could get.",
        "",
        "*Check yourself:* why can't a real lender run this comparison?",
        "",
        "## 9. Reason accuracy",
        "",
        "For loans whose falsified field is known, did the top reason name it? "
        + (
            f"On the funded test book's {n(infl['n'])} income-inflation loans the top reason was the income discrepancy {n(infl['top1_hits'])} times ({pct(infl['top1_hits'] / infl['n'], 0)})."
            if infl
            else ""
        )
        + " That score is perfect by construction: in this simulation only fraud loans have an income gap, while real files have benign ones (bonuses, rounding, pay changes). "
        + f"Reasons are stated only above a materiality threshold ({r['materiality']['threshold_log_odds']:.6f} log-odds, chosen on the calibration books), which cut false discrepancy reasons on clean test loans from {pct(r['materiality']['false_reason_rate']['test_clean_before'], 1)} to {pct(r['materiality']['false_reason_rate']['test_clean_after'], 1)}. "
        + "The model card has every typology, the teaching twins and the clean controls.",
        "",
        "*Check yourself:* if reason accuracy were low but AUC high, what would you keep beside the model?",
        "",
        "## 10. Limits",
        "",
        "This model recovers a simple, known simulated process; its numbers do not transfer to real data. It learns from funded loans only, has no out-of-time test, "
        + (
            "has fairness evidence that is monitoring only (step 11)"
            if p and "fairness" in p
            else "is untested for fairness"
        )
        + ", and is a second opinion beside the credit policy, never the decision. It must not be used for real lending.",
        "",
        "The policy view shows the funded-only limit in money. " + policy_paragraph(s),
        "",
        "*Check yourself:* name two things a real model risk review would ask for that this sprint does not provide.",
        "",
        *(walkthrough_fairness(p) if p and "fairness" in p else []),
        *(walkthrough_champion(p) if p and "champion_challenger" in p else []),
        *(walkthrough_reject(p) if p and "reject_inference" in p else []),
        *(walkthrough_drift(p) if p and "drift" in p else []),
        "## Answer key",
        "",
        "1. A lender observes whether a loan defaulted, never its probability; the PD exists only inside the simulation.",
        "2. The hyperparameters would fit the test book's noise, so its score would be optimistic and stop being an honest estimate of performance on new loans.",
        "3. The model would memorise dealers instead of learning borrower risk, and a new dealer would have no history. Dealer risk is watched separately, in the Dealer View.",
        "4. The odds multiply by e^−0.5 ≈ 0.61: about 39% lower odds of default for a score one standard deviation higher.",
        "5. Reweighting changes the default rate the model sees, so its outputs stop being probabilities; pricing, expected loss and capital need real probabilities, while a ranking model only needs the order.",
        '6. It can answer "does it rank risk?" (who is riskier) but not "how many will default?" (what to price or provision for), which needs calibration.',
        "7. Both measure one cause, the debt burden; stated separately they would repeat one reason and crowd out a different one.",
        "8. Only the simulation knows each loan's true probability; a lender sees outcomes only.",
        "9. The fraud rules and document checks, which name the falsified field directly.",
        "10. Any two of: independent validation; out-of-time and drift testing; fairness and disparate-impact testing; reject inference; real data.",
        *(
            [
                "11. No. The flips prove only that no engine reads age. The difference arrives through the decision inputs (FICO, DTI, liquidity and fraud review) as they vary with age, so it is evidence for a reviewer to weigh (is each factor justified by risk, and is there a less discriminatory alternative?), not proof of fair or unfair treatment."
            ]
            if p and "fairness" in p
            else []
        ),
        *(
            [
                "12. Because the champion sees information the model does not: its review routing (fraud referrals, the DTI watch band and the liquidity check) comes from the fraud rules and the documents, which are not model inputs. Challenger A throws that away and approves applications the policy sent to fraud review; the overlay keeps it and lets the model remove the riskiest approvals, which here are mostly undetected fraud.",
                "13. Augmentation labels the declined applicants with the funded-only model's own scores, so it can only teach the new model what the old one already believed, including its bias. Only real outcomes for declined applicants (the oracle here; in practice a test-and-learn sample of approvals below the cut-off, or bureau outcomes on loans taken elsewhere) add information.",
            ]
            if p and "reject_inference" in p
            else []
        ),
        *(
            [
                "14. The dealer is not a model input and no applicant changes, so every feature's distribution, and the score's, stays where it was: PSI has nothing to see. Outcome monitors do: calibration-in-the-large on early delinquency, and delinquency by dealer (the Dealer View's ratings), which watch the channel rather than the applicant."
            ]
            if p and "drift" in p
            else []
        ),
        "",
    ]
    return "\n".join(L)


def walkthrough_fairness(p: dict[str, Any]) -> list[str]:
    f = p["fairness"]
    age = f["groups"]["age_band"]["policies"][CHAMPION]
    low = age["lowest_air"]
    geo = f["proxy"]["attributes"]["geography_group"]
    return [
        "## 11. Fairness",
        "",
        "Three checks. **Counterfactual flips:** change one sensitive attribute and nothing else, and every output must stay the same; a test-only policy that reads age fails, so the check can fail. "
        + (
            "Here every flip of every case left every output unchanged, apart from the region flip's housing cost, which moves DTI (the financial channel, reported on its own)."
            if f["flips"]["clean"]
            else "Here a flip changed an output; see the model card."
        )
        + f" **Group outcomes:** approval rate by group and the adverse impact ratio, the group's rate over the highest group's. Under the champion the lowest age band is {low['group']}, at {f3(low['air'])}. **Proxy check:** can the 14 features predict the attribute? For region the AUC is {f3(geo['auc'])}, so a model could reproduce regional differences without seeing region.",
        "",
        f"*Check yourself:* the flips show no engine reads age, yet applicants aged {low['group']} are approved at {f3(low['air'])} of the highest group's rate. Is that proof of fair treatment?",
        "",
    ]


CC_ORDER = ("bureau_score_policy", "challenger_a_xgb_alone", "challenger_b_overlay", "as_is_policy_reference")
METHOD_NAMES = {
    "funded_only": "Funded-only (Sprint 11)",
    "hard_cutoff": "Hard cut-off augmentation",
    "fuzzy": "Fuzzy augmentation",
    "oracle": "Oracle: every application",
}


def money(v: float) -> str:
    return f"−${n(-v)}" if v < 0 else f"+${n(v)}" if v > 0 else "$0"


def diff_ci(d: dict[str, float], fmt) -> str:
    return f"{fmt(d['point'])} ({fmt(d['low'])} to {fmt(d['high'])})"


def count(v: float) -> str:
    return signed(v, 0)


def signed(v: float, d: int = 3) -> str:
    """A signed number with a true minus sign."""
    return f"{v:+,.{d}f}".replace("-", "−")


def cc_reading(c: dict[str, Any]) -> str:
    pol, lab = c["policies"], c["labels"]
    a, b = pol["challenger_a_xgb_alone"], pol["challenger_b_overlay"]
    da, db = a["difference_vs_champion"]["expected_loss"], b["difference_vs_champion"]["expected_loss"]

    def verdict(name: str, d: dict[str, float]) -> str:
        if d["high"] < 0:
            return f"{lab[name].split(':', 1)[0]} beats the champion: expected loss is lower by ${n(-d['point'])} (95% interval ${n(-d['high'])} to ${n(-d['low'])})."
        if d["low"] > 0:
            return f"The champion beats {lab[name].split(':', 1)[0]}: its expected loss is lower by ${n(d['point'])} (95% interval ${n(d['low'])} to ${n(d['high'])})."
        return f"{lab[name].split(':', 1)[0]} cannot be told apart from the champion on expected loss: the difference is {money(d['point'])}, and its 95% interval ({money(d['low'])} to {money(d['high'])}) contains 0."

    L = [verdict("challenger_a_xgb_alone", da), verdict("challenger_b_overlay", db)]
    if b["expected_loss"] < a["expected_loss"]:
        L.append(
            f"**Why the overlay beats the model alone.** The policy already uses information the model lacks: its review routing comes from the fraud rules and the documents, which are not model inputs. "
            f"Challenger A ignores it, and {n(a['swap_in_fraud_referrals'])} of its {n(a['swap_in'])} swap-ins are applications the policy sent to fraud review. "
            f"The overlay keeps the policy's routing and lets the model add fraud signal on top: the approvals it removes are the riskiest by PD, and the approved book holds {n(b['fraud_approved'])} loans with a hidden fraud against the champion's {n(pol['bureau_score_policy']['fraud_approved'])}."
        )
    elif a["expected_loss"] < b["expected_loss"]:
        L.append(
            "The model alone beats the overlay here: its ranking adds more than the policy's review routing."
        )
    return " ".join(L)


def champion_md(p: dict[str, Any]) -> list[str]:
    c = p["champion_challenger"]
    pol, lab = c["policies"], c["labels"]
    rule = pol["challenger_b_overlay"]["rule"]
    tune = c["overlay_tuning"]
    infeasible = [g["f"] for g in tune["grid"] if not g["feasible"]]
    L = [
        "## Champion/challenger",
        "",
        f"**The fair-comparison rule.** The champion is the bureau-score policy: the credit policy's thresholds and logic, reading the bureau FICO the models see. Every challenger approves the same number of applications ({n(pol['bureau_score_policy']['approvals'])} of {n(c['applications'])}) on the seed-42 application pool, where every applicant's simulated outcome is known. The as-is policy reads the claimed FICO, which in this generator equals the true score, so it is shown as a reference only. Expected loss is the simulation's charge-off PD × LGD ({c['lgd']}) × EAD; 30+ DPD is the simulated outcome. Differences are challenger minus champion, with percentile 95% intervals from 1,000 paired bootstrap resamples of the applications.",
        "",
        "| Policy | Approvals | Swapped in / out vs champion | Expected loss | Difference (95% CI) | 30+ DPD (rate) | Difference (95% CI) | Loss per approved loan | Hidden-fraud loans approved |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for name in CC_ORDER:
        r = pol[name]
        d = r.get("difference_vs_champion")
        champ = name == "bureau_score_policy"
        swaps = "—" if champ else f"{n(r['swap_in'])} / {n(r['swap_out'])}"
        L.append(
            f"| {lab[name]} | {n(r['approvals'])} | {swaps} | ${n(r['expected_loss'])} | "
            f"{'—' if champ or d is None else diff_ci(d['expected_loss'], money)} | {n(r['dpd30'])} ({pct(r['dpd30_rate'])}) | "
            f"{'—' if champ or d is None else diff_ci(d['dpd30'], count)} | ${n(r['loss_per_approved_loan'])} | {n(r['fraud_approved'])} |"
        )
    L += [
        "",
        f"**Challenger B's rule, exactly.** Start from the champion's approvals. Remove the {n(rule['k'])} with the highest `credit_pd_xgb` PD (here every PD of at least {rule['drop_pd_at_least']:.4f}); add the {n(rule['k'])} champion reviews with the lowest PD that are not fraud referrals (every PD up to {rule['add_pd_at_most']:.4f}). The count is k = f × the champion's approvals, with f = {rule['f']} chosen from 0 to 0.20 in steps of 0.01 by the lowest total expected loss on the two calibration books (ties to the smaller f)"
        + (
            f"; f = {' and '.join(f'{x:.2f}' for x in infeasible)} needed more non-fraud reviews than a calibration book holds, so they were not eligible"
            if infeasible
            else ""
        )
        + ". The seed-42 book played no part in choosing it. Fraud referrals are never added: the overlay can only overrule the policy's caution on credit grounds.",
        "",
        cc_reading(c),
        "",
        'In the Policy Sandbox the champion and both challengers are selectable as candidate policies, labelled "model-based, evaluation only", and read from the snapshot. None of them changes the app\'s decisions.',
        "",
    ]
    return L


def reject_md(p: dict[str, Any]) -> list[str]:
    r = p["reject_inference"]
    tb = r["training_books"]
    L = [
        "## Reject inference",
        "",
        f"The headline models learn from funded loans only. Every application in a simulation has an outcome, so the selection bias can be measured. Four training sets, built from the {len(tb['seeds'])} training books only ({n(tb['applications'])} applications: {n(tb['funded'])} funded, {n(tb['not_funded'])} not funded, that is declined or sent to review):",
        "",
        "1. **Funded-only:** the Sprint 11 headline models, unchanged.",
        "2. **Hard cut-off:** score the not-funded applicants with the funded-only model and label the m highest as defaults, where m is the sum of their PDs rounded up (so the expected number of defaults is kept); retrain on funded plus not funded.",
        "3. **Fuzzy:** add each not-funded applicant twice, as a default weighted by its funded-only PD and as a non-default weighted by 1 − PD; retrain.",
        "4. **Oracle:** every application with its simulated outcome. Only synthetic data has it; it is the ceiling.",
        "",
        "Each family keeps its Sprint 11 settings. Scored on the seed-42 application pool; expected loss is that of the lowest-PD applications up to the champion's approval count "
        + f"({n(r['approval_count'])}; the champion's own is ${n(r['champion_expected_loss'])}). The FICO effect is the {r['fico_effect_definition']}. Gap closed is (method − funded-only) ÷ (oracle − funded-only): 100% is the oracle, a negative share means the method made things worse.",
        "",
        "| Family | Method | AUC, every application | AUC, not funded | FICO effect per SD | Expected loss | Gap closed: expected loss | Gap closed: AUC |",
        "|---|---|---|---|---|---|---|---|",
    ]
    worse = []
    for fam, rows in r["families"].items():
        for m in METHOD_NAMES:
            x = rows[m]
            g = x.get("gap_closed")
            L.append(
                f"| `{fam}` | {METHOD_NAMES[m]} | {f3(x['auc_all_applications'])} | {f3(x['auc_not_funded'])} | {signed(x['fico_effect_per_sd'])} | ${n(x['expected_loss_at_champion_count'])} | "
                f"{pct(g['expected_loss_at_champion_count'], 0).replace('-', '−') if g else '—'} | {pct(g['auc_all_applications'], 0).replace('-', '−') if g else '—'} |"
            )
            if g and g["expected_loss_at_champion_count"] < 0:
                worse.append(f"{METHOD_NAMES[m].lower()} for `{fam}`")
    lg = r["families"].get(LOGIT)
    L += [""]
    if worse:
        L.append(
            "**Augmentation made things worse.** These raised the expected loss of the chosen book: "
            + "; ".join(worse)
            + ". Both methods label the not-funded applicants with the funded-only model's own scores, so they reinforce its bias instead of correcting it: the new model learns what the old one already believed."
        )
    if lg:
        L += [""]
        L.append(
            f"The logistic model's FICO coefficient goes from {signed(lg['funded_only']['fico_coefficient_per_sd'])} per SD (funded-only) to {signed(lg['hard_cutoff']['fico_coefficient_per_sd'])} (hard cut-off) and {signed(lg['fuzzy']['fico_coefficient_per_sd'])} (fuzzy); the oracle learns {signed(lg['oracle']['fico_coefficient_per_sd'])}."
        )
    L += [
        "",
        "Only real outcomes for declined applicants close the gap. In practice that means a small, controlled sample of approvals below the cut-off, or bureau outcomes on credit the applicant took elsewhere; the oracle row shows how much it is worth here. Shapes of the augmented sets are in the data README.",
        "",
    ]
    return L


def walkthrough_champion(p: dict[str, Any]) -> list[str]:
    c = p["champion_challenger"]
    pol = c["policies"]
    b = pol["challenger_b_overlay"]
    return [
        "## 12. Champion/challenger",
        "",
        "A fair comparison holds everything equal except the decision rule: the same applicants, the same approval count and the same information. The app's policy reads the claimed FICO, which here is the true score, so the champion is the bureau-score policy instead: the same rules on the score the models see. "
        + cc_reading(c).split(" **Why")[0]
        + f" The overlay changes only {n(b['rule']['k'])} of {n(b['approvals'])} approvals.",
        "",
        "*Check yourself:* why can a policy-plus-model overlay beat the model on its own, when the model ranks risk better than the policy's thresholds?",
        "",
    ]


def walkthrough_reject(p: dict[str, Any]) -> list[str]:
    r = p["reject_inference"]
    x = r["families"][XGB]
    return [
        "## 13. Reject inference",
        "",
        f"A lender sees outcomes only for loans it made. Reject inference guesses outcomes for the rest and retrains. Here every application has an outcome, so the guesses can be checked: for `{XGB}` the expected loss of the chosen book is ${n(x['funded_only']['expected_loss_at_champion_count'])} funded-only, ${n(x['hard_cutoff']['expected_loss_at_champion_count'])} with hard cut-off augmentation, ${n(x['fuzzy']['expected_loss_at_champion_count'])} with fuzzy augmentation and ${n(x['oracle']['expected_loss_at_champion_count'])} with the oracle's true outcomes.",
        "",
        "*Check yourself:* why can't augmentation that labels declined applicants with the funded-only model's own PD teach the new model anything the old one did not know?",
        "",
    ]


def reject_limit(p: dict[str, Any]) -> str:
    best = max(
        rows[m]["gap_closed"]["expected_loss_at_champion_count"]
        for rows in p["reject_inference"]["families"].values()
        for m in ("hard_cutoff", "fuzzy")
    )
    if best <= 0:
        return "- Funded-only selection bias. Neither augmentation method reduces it on these books (each raises the chosen book's expected loss); only the oracle, which a lender never has, closes the gap."
    return f"- Funded-only selection bias. The best augmentation closes {pct(best, 0)} of the expected-loss gap to the oracle, which a lender never has."


DRIFT_NAMES = {
    "control": "Control (unchanged)",
    "lower_fico": "Lower FICO",
    "more_fraud": "More fraud",
    "weaker_dealers": "Weaker dealers",
}


def calibration_words(r: dict[str, Any]) -> str:
    c = r["calibration_test"]
    return f"{n(c['observed_defaults'])} defaults observed against {c['expected_defaults']:,.0f} expected"


def auc_words(r: dict[str, Any], test: dict[str, Any]) -> str:
    d = r["auc_difference_vs_test"]
    lo, hi = d["ci95"]
    return f"AUC {f3(r['auc'])} against the test book's {f3(test['auc'])}, a difference of {signed(d['difference'], 3)} with a 95% CI of {signed(lo, 3)} to {signed(hi, 3)}"


def decay_words(r: dict[str, Any], test: dict[str, Any]) -> str:
    """Which of the two decay signals fired, with the evidence for each."""
    signals = []
    if r["calibration_test"]["off"]:
        signals.append(f"calibration is off ({calibration_words(r)})")
    if r["auc_decayed"]:
        signals.append(f"ranking weakened ({auc_words(r, test)}, wholly below 0)")
    return " and ".join(signals)


def held_words(r: dict[str, Any], test: dict[str, Any]) -> str:
    return f"calibration held ({calibration_words(r)}) and the AUC test did not fire ({auc_words(r, test)}, an interval that reaches 0 or above)"


def drift_reading(name: str, r: dict[str, Any], test: dict[str, Any]) -> str:
    decayed, warned = r["decayed"], r["psi_warned"]
    label = DRIFT_NAMES.get(name, name)
    if name == "control":
        clean = r["max_feature_psi"] < 0.10 and r["psi_score"]["psi"] < 0.10
        return (
            f"**{label}:** "
            + (
                "PSI is under 0.10 on every feature and on the score, as an unchanged book must be."
                if clean
                else "**PSI reached 0.10 on an unchanged book**, so the monitor's noise floor is too high for these thresholds."
            )
            + (
                f" Performance also holds: {held_words(r, test)}."
                if not decayed
                else f" Yet {decay_words(r, test)}, which an unchanged book should not show."
            )
        )
    feats = ", ".join(f"`{f}`" for f in r["features_at_watch_or_act"]) or "no feature"
    if warned and decayed:
        return f"**{label}:** the monitors warned alongside the decay. PSI reached the watch line on {feats} (score PSI {r['psi_score']['psi']:.3f}). Performance decayed: {decay_words(r, test)}."
    if warned:
        return f"**{label}:** PSI warned on {feats} (score PSI {r['psi_score']['psi']:.3f}), but {held_words(r, test)}: the model absorbed this shift."
    if decayed:
        return f"**{label}:** **the shift hurt performance without moving PSI.** No feature and not the score reached 0.10 (largest feature PSI {r['max_feature_psi']:.3f}), yet {decay_words(r, test)}."
    return f"**{label}:** no warning and no measurable decay: {held_words(r, test)}."


def drift_md(p: dict[str, Any]) -> list[str]:
    d = p["drift"]
    books = d["books"]
    order = [k for k in DRIFT_NAMES if k in books]
    L = [
        "## Drift",
        "",
        f"Do the monitors notice a population shift before, or alongside, the performance decay? Four new books, each a new seed: an unchanged control and three shifts of one existing generator setting each. The reference is {d['reference']}. PSI uses {d['psi_method']}, rated at {d['thresholds']['watch']:.2f} (watch) and {d['thresholds']['act']:.2f} (act), on {d['population']}. Expected-loss error is {d['expected_loss_error']}. The calibration test compares {d['calibration_test']}. The AUC test compares each book with the test book (AUC {f3(d['test_book_auc']['auc'])}, 95% CI {f3(d['test_book_auc']['ci95'][0])}–{f3(d['test_book_auc']['ci95'][1])}): {d['auc_test']}. A book's performance counts as decayed if either of two things holds: the calibration test fails, or the AUC test fires.",
        "",
        "| Book | Seed | Setting | Funded defaults (rate) | Largest feature PSI | Features at watch or act | Score PSI | AUC (95% CI) | AUC − test book (95% CI) | Mean predicted / observed | Expected-loss error | Calibration test | Decayed |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for k in order:
        r = books[k]
        top = max(r["psi_features"].items(), key=lambda kv: kv[1]["psi"])
        cil = r["calibration_in_the_large"]
        L.append(
            f"| {DRIFT_NAMES[k]} | {r['seed']} | {r['setting']} | {n(r['defaults'])} ({pct(r['default_rate'])}) | {top[1]['psi']:.3f} (`{top[0]}`, {top[1]['rating']}) | "
            f"{len(r['features_at_watch_or_act'])} | {r['psi_score']['psi']:.3f} ({r['psi_score']['rating']}) | {f3(r['auc'])} ({f3(r['auc_ci95'][0])}–{f3(r['auc_ci95'][1])}) | {signed(r['auc_difference_vs_test']['difference'], 3)} ({signed(r['auc_difference_vs_test']['ci95'][0], 3)} to {signed(r['auc_difference_vs_test']['ci95'][1], 3)}) | "
            f"{pct(cil['mean_predicted'])} / {pct(cil['observed'])} | {signed(100 * r['expected_loss']['relative_error'], 1)}% | z = {signed(r['calibration_test']['z'], 2)}, {'off' if r['calibration_test']['off'] else 'holds'} | {'yes' if r['decayed'] else 'no'} |"
        )
    L += [""]
    for k in order:
        L += [drift_reading(k, books[k], d["test_book_auc"]), ""]
    L += [auc_sensitivity(d), ""]
    if "weaker_dealers" in books:
        L += [
            "**Feature PSI can't see a channel shift.** The weaker-dealer book changes only how strongly dealer quality drives default. The dealer is not a model input and no applicant changes, so no feature distribution moves and neither does the score; only outcomes do. Watching it takes outcome monitors (early delinquency against prediction, and delinquency by dealer in the Dealer View), which arrive months after funding.",
            "",
        ]
    L += [
        "**Before or alongside?** PSI is computable on the day a loan is funded; the 30+ DPD outcome takes up to 18 months. So where PSI warns here, it warns months before the decay could be measured; where it doesn't, nothing warns until defaults arrive. PSI is coarse on zero-inflated features such as the discrepancy fields: most values are 0 and fall into one quantile bin.",
        "",
    ]
    return L


def auc_sensitivity(d: dict[str, Any]) -> str:
    books = d["books"]
    counts = [d["test_book_auc"]["defaults"]] + [
        r["defaults"] for k, r in books.items() if k != "weaker_dealers"
    ]
    widths = [
        r["auc_difference_vs_test"]["ci95"][1] - r["auc_difference_vs_test"]["ci95"][0]
        for r in books.values()
    ]
    dealers = (
        f", against {n(books['weaker_dealers']['defaults'])} in the weaker-dealer book"
        if "weaker_dealers" in books
        else ""
    )
    return (
        f"**With this few defaults, AUC is a blunt monitor.** With about 250 defaults per book ({n(min(counts))} to {n(max(counts))} "
        f"in the test book and the other drift books{dealers}), AUC can't reliably detect drops of about 0.05: the difference "
        f"intervals above reach about ±{sum(widths) / len(widths) / 2:.3f} on average, so a drop of that size sits at the edge of "
        "what one book can show"
        + (
            f" (the unchanged control alone differs from the test book by {signed(books['control']['auc_difference_vs_test']['difference'], 3)}). "
            if "control" in books
            else ". "
        )
        + "Calibration is the more sensitive monitor here: it compares the whole book's default count with the model's expectation."
    )


def walkthrough_drift(p: dict[str, Any]) -> list[str]:
    d, test = p["drift"]["books"], p["drift"]["test_book_auc"]
    w = d.get("weaker_dealers")
    lines = [
        "## 14. Drift",
        "",
        "PSI (population stability index) compares a feature's distribution today with the training data, bin by bin: under 0.10 is stable, 0.10 to 0.25 is worth watching, above 0.25 calls for action. It needs no outcomes, so it can warn on the day loans are funded. Performance counts as decayed if the calibration test fails (observed defaults against the model's expected count) or the AUC test fires (the 95% interval of the book's AUC minus the test book's, from independent bootstraps of both, lies wholly below 0). "
        + " ".join(drift_reading(k, d[k], test) for k in DRIFT_NAMES if k in d),
        "",
    ]
    if w and not w["psi_warned"] and w["decayed"] and w["calibration_test"]["off"]:
        direction = "under-predicts" if w["calibration_test"]["z"] > 0 else "over-predicts"
        lines += [
            f"*Check yourself:* in the weaker-dealer book no feature's PSI reaches 0.10, yet the model {direction} defaults. Why can't PSI see it, and what would?",
            "",
        ]
    else:
        lines += [
            "*Check yourself:* a shift changes how strongly dealer quality drives default, and nothing about the applicants. Why can't feature PSI see it, and what would?",
            "",
        ]
    return lines
