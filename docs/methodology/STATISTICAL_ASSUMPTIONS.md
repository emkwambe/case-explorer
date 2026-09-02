# Statistical Assumptions

How the generator turns configuration into a case, what each modelling choice implies, and where it is known to be unrealistic. Code references are to `src/core/life.js` unless stated.

## 1. Generation order

For one case, `generateLifeScript` consumes a single seeded random stream in this fixed order:

1. Copula primitives (age, salary_base, dti, checking_balance, credit_score) if `copula.enabled`.
2. Regime (categorical), then persona (salary-rank weighted), then geography region and ZIP.
3. Latent financial health: `h = N(0,1) + regime shift`, then `h *= copula.dampen_latent_health` (0.6).
4. Employment (salary, tenure), liabilities, assets, credit score, each adjusted by `h`.
5. Events: employment start, optional raise, liability openings, housing history.
6. Income stream, expense obligations, closed-loop monthly ledger.

`generateCase` (`src/core/case.js`) then applies the corruption operator, synthesises evidence, fixes the loan amount at 3x the stated salary, computes PITI and back-end DTI on both truth and presentation, generates application metadata, derives findings and the label, and finally samples audit attributes and the applicant name.

Implication: every downstream value depends on the order and count of random draws. Inserting a single extra draw anywhere changes every case for a given seed. Reproducibility is version-bound (see section 9).

## 2. Latent financial-health factor

A single unobserved scalar `h` co-moves the four financial primitives:

| Variable | Adjustment | Floor | Config key |
|---|---|---|---|
| salary | `x max(0.5, 1 + 0.25 h)` | 0.5 | `latent.financial_health.income_sensitivity` |
| dti | `x max(0.25, 1 - 0.30 h)` | 0.25 | `dti_sensitivity` |
| checking balance | `x max(0.25, 1 + 0.40 h)` | 0.25 | `checking_sensitivity` |
| credit score | `+ 25 h` | none | `credit_sensitivity` |

Regime shifts `h` before dampening: PRIME +0.5, SUBPRIME -0.8, SELF_EMPLOYED 0. With dampening 0.6 the effective standard deviation of `h` is 0.6 and the regime shifts become +0.3 and -0.48.

What it implies: a one-factor structure in which "good" applicants are simultaneously higher-income, lower-debt, higher-reserve and higher-score. Combined with the regime shift it makes regime a strong predictor of every financial variable.

Where it is unrealistic: real household finances are not one-dimensional (high income with high debt and low reserves is common). The multiplicative floors create kinks in the marginal distributions. The factor is applied on top of the copula (section 3), so the realised correlations exceed the configured matrix and are not reported anywhere; `src/evaluation/generator-quality` measures them empirically but the config does not state a target.

## 3. Gaussian copula

`sampleCorrelatedPrimitives`:

1. Cholesky-factor the 5x5 correlation matrix `R` (throws if not positive definite).
2. Draw five independent standard normals `e` (Box-Muller, `randomNormal`).
3. `z = L e`, so `z ~ N(0, R)`.
4. `u_i = Phi(z_i)` using an Abramowitz-Stegun `erf` approximation (absolute error about 1.5e-7).
5. Map each `u_i` through the marginal inverse CDF.

Variable order and marginals:

| Index | Variable | Marginal inverse CDF | Notes |
|---|---|---|---|
| 0 | age | `Phi^-1(u) x 12.3 + 38.5`, rounded, clamped [22, 70] | Acklam rational approximation for `Phi^-1`. |
| 1 | salary_base | lognormal(median 58000, shape 0.42) | Reference marginal only; see section 4. |
| 2 | dti | `BetaInv(u; 1.5, 6.0) x 0.50` | Inverse computed by bisection on a 200-step trapezoid integral of the beta density with Lanczos gamma normaliser; tolerance 1e-6, up to 100 iterations. |
| 3 | checking_balance | lognormal(median 12000, shape 0.55) | |
| 4 | credit_score | `Phi^-1(u) x 85 + 692`, rounded, clamped [300, 850] | |

Configured correlation matrix (rows and columns in the order above):

```
        age    salary  dti     chk     score
age     1.00   0.20   -0.15    0.10    0.05
salary  0.20   1.00   -0.35    0.40    0.30
dti    -0.15  -0.35    1.00   -0.25   -0.50
chk     0.10   0.40   -0.25    1.00    0.25
score   0.05   0.30   -0.50    0.25    1.00
```

What it implies: the dependence structure is Gaussian (symmetric, no tail dependence) and is set on the latent normal scale. Rank correlations of the outputs before post-processing are `(6/pi) arcsin(rho/2)`, slightly below the entries above.

Where it is unrealistic:

- Real joint distributions of income, debt and assets have asymmetric tail dependence (very high balances cluster with very high incomes far more than the Gaussian allows).
- Every marginal is subsequently transformed (latent factor, persona re-mapping, age term, industry multiplier, regime cap or floor, geography multiplier, clamps), so the copula fixes neither the marginals nor the correlations of the emitted variables. The matrix is best read as "signs and rough strengths of dependence", not as a calibrated target.
- The beta CDF is integrated numerically; with alpha 1.5 the density has a `t^0.5` singularity at zero that the trapezoid rule under-resolves, so very low DTI quantiles are slightly biased.
- Clamping age and score to bounds after the inverse CDF creates point masses at the bounds and breaks the strict monotonicity the copula assumes.

## 4. Salary pipeline and persona re-mapping

Salary is not the copula marginal. In `generateEmployment`:

1. `percentile = lognormalCDF(salary_base; 58000, 0.42)` clamped to [0.001, 0.999].
2. `salary = lognormalInv(percentile; persona_median x geo_salary_multiplier, persona_shape)`; the shape is multiplied by 1.6 for SELF_EMPLOYED.
3. `salary += age x 1200`.
4. If age > 52: `salary *= 0.98^(age - 52)`.
5. `salary *= industry_salary_multiplier[industry]` (1.0 when undefined, which is the SELF_EMPLOYED case).
6. `salary *= max(0.5, 1 + 0.25 h)`.
7. Clamp to `[persona_min, persona_max] x geo_salary_multiplier`.
8. Later, an optional `SALARY_INCREASE` event may raise it by up to 15%, re-clamped to the same band.

What it implies: the copula controls only the applicant's rank within their persona; dollar levels come from persona medians, and the age, industry and latent adjustments shift the whole persona upward (for SOFTWARE_ENGINEER, a 40-year-old at the persona median receives roughly 133000 + 48000 = 181000, then x 1.35 = 244000, clamped to 220000).

Where it is unrealistic: the industry multiplier and persona median double count occupation premia, the additive age term is the same in dollars for a teacher and a software engineer, and the clamps produce large point masses at persona ceilings. The realised salary distribution is therefore not lognormal and its median is well above the configured persona median. This is the single largest gap between config and output and should be resolved before any calibration against BLS OEWS.

## 5. Persona selection by salary rank

`choosePersonaBySalaryRank`:

- `salaryRank = lognormalCDF(salary_base; 58000, 0.42)`, clamped [0.001, 0.999].
- For each persona `i`, `personaRank_i = (median_i - min median) / (max median - min median)`, a linear position on the 46000 to 133000 span.
- `affinity_i = exp(-(salaryRank - personaRank_i)^2 / (2 x 0.35^2))`.
- `weight_i = prior_i x affinity_i`, normalised; sample categorically.

What it implies: high-rank copula draws favour SOFTWARE_ENGINEER and PHYSICIAN_ASSISTANT (personaRank 1.0), low-rank draws favour CONSTRUCTION_WORKER (0.0) and RETAIL_MANAGER (0.05), with sigma 0.35 leaving considerable overlap. Because the copula salary also correlates with age, checking and score, persona inherits those correlations.

Where it is unrealistic: `salaryRank` is a percentile and `personaRank` is a linear position on the dollar scale, so the two are not on the same scale; the mapping is a heuristic. The prior is not an occupational mix of any real applicant population. Persona is chosen independently of regime, so SELF_EMPLOYED can be paired with any persona and then has its industry and employer overwritten.

## 6. Regime and geography multipliers

Regime (PRIME 0.55, SUBPRIME 0.30, SELF_EMPLOYED 0.15) acts through: the latent shift; a PRIME checking multiplier 1.25; a PRIME credit floor 640; a SUBPRIME credit cap 680; a SELF_EMPLOYED income-shape multiplier 1.6 and tenure-rate multiplier 0.6. SUBPRIME `max_dti_ratio` 0.55 does not bind (section PARAMETER_SOURCES).

Geography (HIGH 0.25, MEDIUM 0.50, LOW 0.25) acts through: salary multiplier on the persona median and bounds (1.22 / 1.00 / 0.88); rent multiplier on the uniform base rent (1.65 / 1.05 / 0.72); checking multiplier (1.15 / 1.00 / 0.88). `cost_of_living_index` is carried but never used in a calculation.

What it implies: the PRIME floor guarantees every PRIME case clears the credit approve threshold (640), and the SUBPRIME cap guarantees no SUBPRIME case reaches the "strong credit" reason (720). Regime is therefore nearly a label for the credit dimension of the decision. Geography scales income and rent in the same direction, so DTI and rent-to-income are roughly region-neutral by construction.

Where it is unrealistic: floors and caps create point masses at 640 and 680; the loan amount is 3x salary regardless of region, so high-cost regions do not have higher loan-to-income ratios as they do in HMDA data.

## 7. Closed-loop monthly ledger

`simulateMonthlyLedger` builds `ledger.statement_months` (3) months backward from the as-of date, anchored on the current checking balance:

```
for i = 0 .. months-1 (i = 0 is the current month):
  deposit_i        = round(monthly_net_deposit x (1 + N(0, 0.02)))
  discretionary_i  = round(max(0, discretionary x (1 + N(0, 0.12))))
  outflows_i       = rent + utilities + liabilities + discretionary_i
  starting_i       = ending_i - deposit_i + outflows_i
  ending_{i+1}     = starting_i         (the previous month ends where this one starts)
```

with `ending_0 = truth.checking_balance`. The emitted ledger is in chronological order (oldest first), so the last entry's `ending_checking_balance` equals the current balance and every entry satisfies the identity

```
ending_checking_balance = starting_checking_balance + salary_deposits - total_outflows
```

exactly, in integer dollars. `src/evaluation/generator-quality` checks this identity and that consecutive months chain.

Evidence derived from the ledger: `BANK_STATEMENT.checking_balance` is the last ending balance plus 1% noise; `monthly_payroll_deposit` is the mean of `salary_deposits`; `rent_payments` and `overdraft_count` are copied. `recurring_debits` lists each bureau liability plus rent and utilities, so the bureau, the bank statement and the ledger all agree on obligations for a clean case.

What it implies: the ledger is a deterministic back-solve from the sampled balance, not a forward simulation. An applicant whose outflows exceed deposits shows a balance that was higher three months ago and has been draining; one whose deposits exceed outflows shows a rising balance.

Where it is unrealistic:

- Overdrafts are counted when a starting balance is negative and an `OVERDRAFT` event with a 35 USD fee is recorded, but the fee is not debited, so the identity holds only because the fee is ignored.
- Only four outflow lines and one inflow exist; no transfers, no savings account, no irregular income, no one-off expenses.
- The balance and the flows are sampled independently, so the current balance is not the result of the history. There is no guarantee that a long history would have produced it.
- Three months is the entire observable window; there is no seasonality or trend.

## 8. Document fidelity noise and the evidence-consistency tolerance

`fidelityNoise(value, fidelity, rng) = round(value x (1 + N(0, 1 - fidelity)))` in `src/utils/distributions.js`. Applied with:

| Evidence field | Fidelity | Noise sd |
|---|---|---|
| `W2_DOCUMENT.w2_wages` | 0.98 | 2% of the value |
| `BANK_STATEMENT.checking_balance` | 0.99 | 1% |
| `CREDIT_BUREAU.credit_score` | 0.99 | 1% (about 7 points at 700) |
| `EMPLOYER_VERIFICATION.salary`, `.employer` | exact | 0 |
| everything else | exact | 0 |

The per-document `fidelity` field (N(0.97, 0.02) clamped) is descriptive only and does not drive the noise.

Tolerance: `evidenceConsistencyChecks` in `src/evaluation/generator-quality/index.js` requires, for clean cases, that each noisy field lie within `|value| x (1 - fidelity) x 3.5 + 2` of its ledger or truth source. Under the normal noise model the probability that one field exceeds 3.5 sigma is about 4.7e-4; with three independent noisy fields per case the pass rate is about 99.86%, which is the "honest generator passes at least 99.9% of the time" target stated in the code comment (the extra +2 dollars or points absorbs rounding). The tolerance is therefore a property of the generator's own noise, not an underwriting tolerance: it detects generator regressions, not fraud.

What it implies: an underwriter comparing W-2 wages to stated salary should expect a 2% discrepancy from document noise alone, on top of the structural gap between gross salary and W-2 Box 1 wages (`salary x (1 - deduction rate)`, a 12-36% gap). The fraud rule FR-001 accordingly uses employer-verified salary as its primary comparator and treats overstatement up to 2% as no variance.

Where it is unrealistic: real document errors are not zero-mean multiplicative Gaussians (they are transposed digits, missing pages, wrong tax years, name variants). Employer verification is treated as perfect. The W-2 figure conflates taxes with pre-tax deductions, so W-2 wages are unrealistically far below gross for most applicants.

## 9. Independence by construction of the fairness scenario attributes

`deriveAuditAttributes` (`src/core/audit_attributes.js`) samples `family_status_scenario` (categorical 0.35 / 0.35 / 0.22 / 0.08) and `disability_income_scenario` (Bernoulli 0.04) from the case RNG after every financial variable, finding and label has been computed, using no financial input. They therefore have zero population association with any decision input or output. The fairness module (`src/evaluation/fairness/index.js`) lists them as `INDEPENDENT_SCENARIO_ATTRIBUTES`: any measured disparity across them is a defect in the decision pipeline by definition, and counterfactual twins that flip them must produce identical decisions.

The other audit attributes (`age_band`, `income_band`, `geography_group`, `persona`, `regime`, `zip3`) are deterministic functions of the financial life and are strongly associated with outcomes by construction. Disparities across them are expected and do not by themselves indicate a defect; they show which subgroups the generator makes riskier.

Where it is unrealistic: no real protected attribute is independent of income, age or geography. The independence is a test fixture, not a population claim. The disability scenario generates no income component and family status changes no expense line, so the counterfactual test can only detect direct use of the attribute, never proxy effects.

## 10. Deterministic seeding

`src/utils/prng.js`:

- String seeds are hashed with 32-bit FNV-1a (`h = 2166136261; h ^= c; h *= 16777619` per character, unsigned).
- The resulting 32-bit integer seeds Mulberry32, a 32-bit state generator with period 2^32, returning `[0, 1)` floats with 32 bits of resolution.
- `createRng(undefined | null | "")` returns `Math.random` with `seeded: false`.

Seed derivation in `generateBlendedCase`: mix stream `${seed}-mix-${id}`, case stream `${seed}-${id}`, adversarial truth stream `${seed}-truth-${id}`. Case ids embed `fnv1a(String(caseSeed))` so the id is stable across runs. Unseeded cases get a `Date.now()` suffix and are not reproducible.

What it implies: the same seed, config and generator version produce byte-identical cases (`reproducibilityCheck` verifies this over 25 cases). Different ids under the same batch seed are independent streams by hashing, not by a jump-ahead, so there is no formal guarantee of stream independence; with a 32-bit state, distinct string seeds collide with probability about `n^2 / 2^33` for `n` cases (about 1 in 8000 at n = 1000).

Where it is unrealistic or fragile: Box-Muller calls `log(u1)` and Mulberry32 can return exactly 0 (probability 2^-32 per draw), which yields `-Infinity`; no guard exists. FNV-1a and Mulberry32 are not cryptographic and are not suitable for anything adversarial. Reproducibility is tied to the exact draw sequence, so any refactor that reorders sampling silently changes the dataset while keeping the same seed and id.

## 11. The as-of date

`resolveAsOfDate` returns `config.generation.as_of_date` when set, otherwise the wall-clock date. It sets `application.submitted`, `meta.as_of_date`, the `date` on every evidence document, the ledger month labels, the application-metadata submission timestamp and document-age arithmetic, and the dates of typology deposits.

Everything else is anchored to hard-coded dates: the life script's `startDate` is 2024-01-01 (employment start is 2024-01-01 minus tenure; housing moves are relative to it; raises and liability openings must fall before it), the W-2 `tax_year` is 2024, FABRICATION claims an employment start of 2021-01-01 and BUST_OUT's synthetic timeline starts 2022-01-01.

What it implies: a case generated with `as_of_date` null on 2026-09-02 has evidence dated 2026 and life events dated 2024 and earlier. `tenure_months` is measured to 2024-01-01, not to the submission date, so the underwriter-visible tenure understates true tenure by the gap between 2024-01-01 and the as-of date. There is no drift in rates, prices or fraud mix over the as-of date; the population is stationary.

Where it is unrealistic: any downstream consumer that computes ages, tenures or document staleness from the as-of date against life-script dates will see a fixed offset. Setting `generation.as_of_date` to a date in early 2024 is the only way to make the two calendars coincide with the current code.

## 12. Application metadata

`generateApplicationMetadata` draws one Bernoulli(`fraud_signal_rate` = 0.6) per fraud-typology case. On success every metadata distribution switches to the "signalled" version (late-night hours with probability 0.45 x intensity, IP risk uniform on [0.55, 1.0], VPN 0.35 x intensity, Tor 0.12 x intensity, documents 0-3 days old, faster typing, more copy-paste, shorter sessions), where intensity is 1.0 / 0.6 / 0.3 for HIGH / MEDIUM / LOW severity. On failure, and for every NONE and INCOHERENT case, the clean distributions are used.

What it implies: among signalled fraud cases, the IP-risk rule (> 0.7 or Tor) fires with probability about two thirds and the document-age rule (3 of 4 documents within 2 days, each with probability 3/4) with probability about 0.74, so most signalled fraud cases are declined on metadata alone before any financial rule is consulted. Clean cases can still be declined on metadata through the 0.5% Tor rate.

Where it is unrealistic: the mixture is two well-separated regimes with no overlap in the document-age dimension (clean 14-180 days, signalled 0-3 days); real device and behaviour signals are weak, noisy and shared across legitimate populations. See LIMITATIONS.
