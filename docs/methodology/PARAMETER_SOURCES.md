# Parameter Sources

Every top-level parameter group in `src/distribution_config.json`, with the code path that consumes it, the transformation applied, and an honest statement of where the value came from.

## Provenance classes

| Class | Meaning |
|---|---|
| EMPIRICALLY_CALIBRATED | Fitted to, or checked against, a named public series. **No parameter in the current config has reached this class.** Rows that are plausibly close to a public statistic are marked "APPROXIMATE - not yet verified against source" and name the series to check. |
| SIMPLIFYING_ASSUMPTION | Hand-chosen modelling convenience; no external claim of realism. |
| STRESS_SCENARIO | Chosen to exercise a decision boundary or to create population contrast (regimes, adversarial targeting). |
| FRAUD_INJECTION | Governs how often or how strongly a fraud typology is injected. |

The "gini" parameter used by every lognormal in this config is a shape parameter, not the Gini coefficient of the resulting distribution: the code maps it to a log-scale standard deviation via `sigma = sqrt(2 ln(1 + gini^2))` (`randomLognormal`, `lognormalInverseCDF` in `src/utils/distributions.js`). For `gini = 0.42` this gives sigma about 0.57 and a true Gini of roughly 0.31; for `gini = 0.55`, sigma about 0.73 and true Gini roughly 0.39. Comparisons to published Gini coefficients must go through that conversion.

Unless noted, "Applicable year" is "none stated": the config carries no vintage, and the only dates hard-coded in the generator are 2024-01-01 (life-script anchor) and tax year 2024 on the W-2.

## demographics

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `age.mean` / `age.stddev` | 38.5 / 12.3 | normal | APPROXIMATE - not yet verified against source. Should be checked against NAR Profile of Home Buyers and Sellers (median age of first-time and repeat buyers) and HMDA applicant age bands. | none stated | mortgage applicants | Sampled via copula inverse normal CDF; clamped to [min, max]; rounded | Clamping creates mass at 22 and 70. Real buyer age is right-skewed and bimodal (first-time vs repeat); a single normal cannot show that. | SIMPLIFYING_ASSUMPTION |
| `age.min` / `age.max` | 22 / 70 | bounds | Hand-chosen | | | clamp | Excludes applicants under 22 and over 70. | SIMPLIFYING_ASSUMPTION |
| `ssn_last4` | 1000-9999 | uniform_int | Identity token only | | | none | 0000-0999 excluded. | SIMPLIFYING_ASSUMPTION |

## employment

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `salary_base.median` | 58000 | lognormal | APPROXIMATE - not yet verified against source. Should be checked against BLS OEWS national median annual wage and Census ACS median earnings for full-time workers. | none stated | US wage earners (not mortgage applicants) | Used only as the copula reference marginal: the copula salary sample is converted to a percentile under this distribution and re-mapped onto the persona distribution. | Persona medians override it for every case, so the value affects only ranks, not dollar levels. | SIMPLIFYING_ASSUMPTION |
| `salary_base.gini` | 0.42 | lognormal shape | Mislabelled Gini; see note above | | | shape parameter | True Gini of the marginal is about 0.31. | SIMPLIFYING_ASSUMPTION |
| `employment_gap_prob.p` | 0.18 | bernoulli | Hand-chosen | | | sampled into `hasGap` | `hasGap` is sampled and then discarded; it never reaches the case object. Dead parameter. | SIMPLIFYING_ASSUMPTION |
| `tenure_months.rate` | 0.035 | exponential | Hand-chosen; implies mean tenure 1/0.035 = 28.6 months | none stated | | clamped [1, 480]; rounded; rate multiplied by 0.6 for SELF_EMPLOYED (mean 47.6 months) | Should be checked against BLS Employee Tenure survey (median tenure of wage and salary workers, roughly 4 years). The exponential has no memory, so long tenures are under-represented and 1-month tenures are the mode. Tenure is measured to 2024-01-01, not to the as-of date. | SIMPLIFYING_ASSUMPTION |
| `tenure_months.min` / `max` | 1 / 480 | bounds | Hand-chosen | | | clamp | | SIMPLIFYING_ASSUMPTION |
| `industry.categories` / `probabilities` | 7 industries; 0.18, 0.14, 0.12, 0.15, 0.10, 0.13, 0.18 | categorical | Hand-chosen | | | Only used when no persona supplies an industry. Every configured persona supplies one, so this is a fallback that never fires under the default config. | Dead under default config. Should be checked against BLS Current Employment Statistics if reactivated. | SIMPLIFYING_ASSUMPTION |
| `industry_salary_multiplier` | Education 0.82, Other 1.0, Finance 1.42, Healthcare 1.15, Technology 1.35, Manufacturing 0.95, Retail 0.78 | multiplier | Hand-chosen | | | Multiplies salary after the persona median has already been applied | Double counts: SOFTWARE_ENGINEER median 133000 x Technology 1.35 exceeds the persona max and is clamped to 220000, so the persona distribution piles up at its ceiling. `Professional Services` (SELF_EMPLOYED) has no entry and defaults to 1.0. | SIMPLIFYING_ASSUMPTION |
| `salary_by_age.age_coefficient` | 1200 | additive USD/year of age | Hand-chosen | | | `salary += age * 1200` | Adds a fixed 26k-84k on top of persona medians before clamping; not an age-earnings profile from any source. Should be replaced by an age-earnings curve from Census ACS or BLS CPS. | SIMPLIFYING_ASSUMPTION |
| `salary_by_age.peak_age` / `decline_rate` | 52 / 0.02 | geometric decline | Hand-chosen | | | `salary *= (1 - 0.02)^(age - 52)` above 52 | | SIMPLIFYING_ASSUMPTION |

## personas

Persona is selected by salary rank (see STATISTICAL_ASSUMPTIONS). Persona `student_loan_prob`, `tenure_stability` and `industry` are read as follows: `industry` drives the industry multiplier; `tenure_stability` is copied to the case as a label and does not alter tenure sampling; `student_loan_prob` is **not read** (the global `liabilities.student_loan_prob.p` is used for every persona).

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `probabilities` | SOFTWARE_ENGINEER 0.18, TEACHER 0.14, NURSE 0.12, CONSTRUCTION_WORKER 0.08, ENTREPRENEUR 0.08, PHYSICIAN_ASSISTANT 0.08, RELOCATED_PROFESSIONAL 0.08, RETAIL_MANAGER 0.12, FINANCE_ANALYST 0.12 | categorical prior | Hand-chosen | | | Prior reweighted by Gaussian affinity to copula salary rank | Not an occupational mix of any real applicant population; software engineers and physician assistants are heavily over-represented relative to BLS OEWS employment counts. | SIMPLIFYING_ASSUMPTION |
| `SOFTWARE_ENGINEER.salary_median` | 133000 | lognormal | APPROXIMATE - not yet verified against source. Check BLS OEWS "Software Developers" median annual wage. | none stated | national | median x geo multiplier; shape 0.30; clamp [80000, 220000] x geo | Then further multiplied by age term, industry 1.35 and latent health, so the realised median is well above 133000 and clamps at 220000. | SIMPLIFYING_ASSUMPTION |
| `TEACHER.salary_median` | 65000 | lognormal | APPROXIMATE - not yet verified against source. Check BLS OEWS elementary/secondary teacher medians. | | | shape 0.18; clamp [45000, 100000] | Industry multiplier 0.82 then applied. | SIMPLIFYING_ASSUMPTION |
| `NURSE.salary_median` | 94000 | lognormal | APPROXIMATE - not yet verified against source. Check BLS OEWS "Registered Nurses". | | | shape 0.20; clamp [65000, 140000] | Industry multiplier 1.15 then applied. | SIMPLIFYING_ASSUMPTION |
| `CONSTRUCTION_WORKER.salary_median` | 46000 | lognormal | APPROXIMATE - not yet verified against source. Check BLS OEWS "Construction Laborers". | | | shape 0.22; clamp [30000, 75000] | Mapped to Manufacturing industry (0.95), which is not construction. | SIMPLIFYING_ASSUMPTION |
| `ENTREPRENEUR.salary_median` | 65000 | lognormal | Hand-chosen | | | shape 0.55; clamp [15000, 400000] | No public series for "entrepreneur" income; Census nonemployer statistics or SCF business-owner income would be the closest. | SIMPLIFYING_ASSUMPTION |
| `PHYSICIAN_ASSISTANT.salary_median` | 133000 | lognormal | APPROXIMATE - not yet verified against source. Check BLS OEWS "Physician Assistants". | | | shape 0.16; clamp [90000, 180000] | | SIMPLIFYING_ASSUMPTION |
| `RELOCATED_PROFESSIONAL.salary_median` | 85000 | lognormal | Hand-chosen | | | shape 0.32; clamp [45000, 180000] | "Recent" tenure label does not shorten tenure. | SIMPLIFYING_ASSUMPTION |
| `RETAIL_MANAGER.salary_median` | 50000 | lognormal | APPROXIMATE - not yet verified against source. Check BLS OEWS "First-Line Supervisors of Retail Sales Workers". | | | shape 0.18; clamp [30000, 85000] | | SIMPLIFYING_ASSUMPTION |
| `FINANCE_ANALYST.salary_median` | 100000 | lognormal | APPROXIMATE - not yet verified against source. Check BLS OEWS "Financial and Investment Analysts". | | | shape 0.25; clamp [60000, 180000] | Industry multiplier 1.42 then applied. | SIMPLIFYING_ASSUMPTION |
| `*.salary_gini` | 0.16-0.55 | lognormal shape | Hand-chosen | | | see Gini note | | SIMPLIFYING_ASSUMPTION |
| `*.salary_min` / `salary_max` | per persona | bounds | Hand-chosen | | | clamp, scaled by geography salary multiplier | Creates point masses at the bounds. | SIMPLIFYING_ASSUMPTION |
| `*.student_loan_prob` | 0.20-0.70 | bernoulli | Hand-chosen | | | **not read by code** | Dead parameter. | SIMPLIFYING_ASSUMPTION |
| `*.tenure_stability` | label | | Hand-chosen | | | copied to case; selects the income-volatility class in the performance simulation | No effect on tenure sampling itself. | SIMPLIFYING_ASSUMPTION |

## income

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `pay_frequency` | BIWEEKLY 0.60, SEMIMONTHLY 0.25, MONTHLY 0.15 | categorical | APPROXIMATE - not yet verified against source. Check BLS Current Employment Statistics "length of pay periods" release. | none stated | private employers | checks per year 26 / 24 / 12 | Weekly pay is omitted, though it is common for hourly workers. | SIMPLIFYING_ASSUMPTION |
| `pretax_deduction_rate` | Beta(2.5, 6) scaled to [0.12, 0.36] | beta | Hand-chosen; represents all withholding and pre-tax deductions as one rate | | | applied to gross to get net per check and W-2 wages | Treats taxes and pre-tax deductions identically; W-2 Box 1 wages exclude pre-tax deductions but not taxes, so `annual_w2_wages = salary x (1 - rate)` conflates the two. No dependence on income level, state or filing status. | SIMPLIFYING_ASSUMPTION |
| `payroll_variance.stddev` | 0.02 | normal | Hand-chosen | | | multiplicative noise on monthly ledger deposit | Salaried workers usually have zero variance; hourly workers much more. | SIMPLIFYING_ASSUMPTION |

## liabilities

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `dti_ratio` | Beta(1.5, 6) scaled to [0.0, 0.50] | beta | Hand-chosen | none stated | | Copula inverse beta CDF (numerical); then `x max(0.25, 1 - 0.30 x financial_health)`; clamp | This is a front-end obligation ratio before the mortgage; HMDA reports back-end DTI including the proposed payment, so the two are not directly comparable. Should be checked against HMDA DTI distributions and CFPB mortgage market reports after adding PITI. | SIMPLIFYING_ASSUMPTION |
| `student_loan_prob.p` | 0.42 | bernoulli | APPROXIMATE - not yet verified against source. Check Federal Reserve SCF share of families with education debt (lower, around 20-25% of all families, higher among younger households). | | | | Applied to every persona regardless of the persona value. | SIMPLIFYING_ASSUMPTION |
| `student_loan_amount.median` | 39000 | lognormal | APPROXIMATE - not yet verified against source. Check Federal Reserve SCF or Federal Student Aid portfolio average balance per borrower. | | | balance x 0.01 = monthly payment | The 1% of balance payment rule is an underwriting convention (Fannie Mae Selling Guide student-loan payment calculation), not an observed payment. | SIMPLIFYING_ASSUMPTION |
| `student_loan_amount.gini` | 0.50 | lognormal shape | Hand-chosen | | | | | SIMPLIFYING_ASSUMPTION |
| `auto_loan_prob.p` | 0.58 | bernoulli | APPROXIMATE - not yet verified against source. Check Federal Reserve SCF share of families with vehicle loans (around one third) and NY Fed Consumer Credit Panel. | | | | Probably too high for the whole population. | SIMPLIFYING_ASSUMPTION |
| `auto_loan_payment` | N(600, 170) clamped [250, 1100] | normal | APPROXIMATE - not yet verified against source. Check Experian State of the Automotive Finance Market average monthly payment. | | | clamp; rounded | | SIMPLIFYING_ASSUMPTION |
| `credit_card_utilization` | Beta(1.8, 4.2) | beta | Hand-chosen | | | **not read by code** | Dead parameter. | SIMPLIFYING_ASSUMPTION |

Residual debt: `otherDebt = max(0, salary x dti / 12 - student - auto)` is assigned to a `REVOLVING_OTHER` bureau tradeline. The DTI sample, not the individual loans, determines total obligations.

## assets

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `checking_balance.median` | 12000 | lognormal | APPROXIMATE - not yet verified against source. Check Federal Reserve SCF median transaction-account balance (lower for all families, roughly 5-8k in recent waves; higher for homeowners). | none stated | | Copula inverse lognormal; `x max(0.25, 1 + 0.40 x financial_health)`; x 1.25 if PRIME; x geography checking multiplier; rounded | Represents total liquid reserves in a single account; no savings, retirement or brokerage accounts. | SIMPLIFYING_ASSUMPTION |
| `checking_balance.gini` | 0.55 | lognormal shape | Hand-chosen | | | | True Gini about 0.39; SCF wealth concentration is far higher. | SIMPLIFYING_ASSUMPTION |
| `savings_rate` | Beta(2, 8) | beta | Hand-chosen (mean 0.20 of gross monthly) | | | monthly savings = salary/12 x rate | Only feeds `down_payment`, which no decision reads. Check BEA personal saving rate if reactivated. | SIMPLIFYING_ASSUMPTION |
| `down_payment_months` | N(18, 8) clamped [3, 60] | normal | Hand-chosen | | | `down_payment = monthly savings x months` | Not linked to loan amount or LTV. No decision reads it, but the performance simulation now subtracts it (capped at the checking balance) from liquid assets to get reserves at closing, so it drives how much buffer a borrower starts with. | SIMPLIFYING_ASSUMPTION |

## expenses

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `rent_to_income_gross_ratio` | Beta(2.2, 5) scaled [0.18, 0.42] | beta | Hand-chosen | | | **not read by code** | Rent is actually `uniform_int(1000, 2200) x geography rent multiplier`, independent of income (`generateHousingHistory`). Dead parameter. Check Census ACS gross rent as a percentage of household income if wired in. | SIMPLIFYING_ASSUMPTION |
| `utility_amount` | N(185, 45) clamped [80, 380] | normal | APPROXIMATE - not yet verified against source. Check BLS Consumer Expenditure Survey utilities, fuels and public services. | | | rounded | Not scaled by region or household size. | SIMPLIFYING_ASSUMPTION |
| `discretionary_rate` | Beta(2, 5) scaled [0.05, 0.25] | beta | Hand-chosen | | | share of gross monthly income; x (1 + N(0, 0.12)) per ledger month | Food, transport, insurance and childcare are all folded into this one line. | SIMPLIFYING_ASSUMPTION |

## credit

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `score_base` | N(692, 85) clamped [300, 850] | normal | APPROXIMATE - not yet verified against source. Check FICO national average score publications and Federal Reserve Bank of New York Consumer Credit Panel / Equifax score distributions. Mortgage borrowers skew higher (median origination score often above 750 per NY Fed Quarterly Report on Household Debt and Credit). | none stated | general population, not mortgage applicants | Copula inverse normal; `+ dti x 100 x (-20/10)` (i.e. minus 2 points per DTI percentage point); `+ 25 x financial_health`; 12% chance of a derogatory hit of 40-120 points; regime cap 680 (SUBPRIME) or floor 640 (PRIME); clamp; rounded | Real score distributions are left-skewed with a ceiling pile-up, not normal. | SIMPLIFYING_ASSUMPTION |
| `score_by_dti.dti_penalty` | -20 | linear | Hand-chosen | | | see above | | SIMPLIFYING_ASSUMPTION |
| `inquiry_count` | Poisson(2.3) | poisson | Hand-chosen | | | **not read by code** | Dead parameter. | SIMPLIFYING_ASSUMPTION |
| derogatory event (hard-coded) | p = 0.12, 40-120 points | bernoulli x uniform | Hard-coded in `generateCreditScore` | | | | Not in config. | SIMPLIFYING_ASSUMPTION |

## ledger

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `statement_months` | 3 | constant | Standard lender requirement for bank statements (2-3 months; Fannie Mae Selling Guide asset documentation). Verification of the exact requirement pending. | | | ledger length; `months_of_statements` | | SIMPLIFYING_ASSUMPTION |
| `max_negative_balance_months` | 2 | constant | Hand-chosen | | | **not read by code** | Dead parameter; overdrafts are counted but never capped or acted on. | SIMPLIFYING_ASSUMPTION |
| `overdraft_fee` | 35 | constant | APPROXIMATE - not yet verified against source. Check CFPB overdraft fee reports (typical fee historically around 35 USD; many banks have since reduced or eliminated it). | | | recorded as an event; **not debited from the balance** | The accounting identity ignores the fee. | SIMPLIFYING_ASSUMPTION |
| discretionary noise (hard-coded) | N(0, 0.12) | normal | Hard-coded in `simulateMonthlyLedger` | | | | Not in config. | SIMPLIFYING_ASSUMPTION |

## latent

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `financial_health` | N(0, 1) | normal | Modelling device: a single unobserved factor that co-moves income, debt, reserves and credit | | | `+ regime shift`; `x copula.dampen_latent_health` (0.6) | Not identifiable from data in this form. | SIMPLIFYING_ASSUMPTION |
| `income_sensitivity` | 0.25 | multiplier | Hand-chosen | | | `salary x max(0.5, 1 + 0.25 h)` | Stacked on top of the copula correlation, so effective correlations exceed the configured matrix. | SIMPLIFYING_ASSUMPTION |
| `dti_sensitivity` | 0.30 | multiplier | Hand-chosen | | | `dti x max(0.25, 1 - 0.30 h)` | | SIMPLIFYING_ASSUMPTION |
| `checking_sensitivity` | 0.40 | multiplier | Hand-chosen | | | `checking x max(0.25, 1 + 0.40 h)` | | SIMPLIFYING_ASSUMPTION |
| `credit_sensitivity` | 25 | additive points | Hand-chosen | | | `score + 25 h` | | SIMPLIFYING_ASSUMPTION |

## copula

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `enabled` | true | flag | | | | | | SIMPLIFYING_ASSUMPTION |
| `variables` | age, salary_base, dti, checking_balance, credit_score | order of the matrix | | | | | | SIMPLIFYING_ASSUMPTION |
| `dampen_latent_health` | 0.6 | multiplier | Hand-chosen to keep total dependence from becoming excessive when copula and latent factor stack | | | scales financial_health | | SIMPLIFYING_ASSUMPTION |
| `correlation_matrix` | age-salary 0.20, age-dti -0.15, age-checking 0.10, age-credit 0.05, salary-dti -0.35, salary-checking 0.40, salary-credit 0.30, dti-checking -0.25, dti-credit -0.50, checking-credit 0.25 | Gaussian copula | Hand-chosen signs and magnitudes; directions are consistent with common sense and with published summaries (higher income with higher balances and scores, higher DTI with lower scores) but none is fitted. Should be checked against Federal Reserve SCF micro-data (income, liquid assets, debt payments to income) and, for score-DTI, against HMDA loan-level data joined to score bands where available. | none stated | | Cholesky factor; z = L e; u = Phi(z); marginal inverse CDFs | These are correlations of the latent normals, not of the output variables; post-processing (latent factor, multipliers, clamps) changes the realised correlations. `scripts/calibrate_copula.js` exists but no calibrated output is stored in the config. | SIMPLIFYING_ASSUMPTION |

## regimes

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `probabilities` | PRIME 0.55, SUBPRIME 0.30, SELF_EMPLOYED 0.15 | categorical | Hand-chosen for population contrast | | | | The SUBPRIME share is far above the share of sub-680 originations in recent years (NY Fed Quarterly Report on Household Debt and Credit shows most mortgage originations to 760+ borrowers). Self-employed share should be checked against BLS self-employment rate (roughly 10%). Persona and regime are sampled independently, so SELF_EMPLOYED teachers and nurses occur. | STRESS_SCENARIO |
| `PRIME.financial_health_shift` | +0.5 | additive | Hand-chosen | | | added before dampening | | STRESS_SCENARIO |
| `PRIME.checking_balance_multiplier` | 1.25 | multiplier | Hand-chosen | | | | | STRESS_SCENARIO |
| `PRIME.credit_score_floor` | 640 | floor | Hand-chosen; equals the underwriting approve threshold | | | `max(score, 640)` | Guarantees PRIME never fails the credit approve threshold. | STRESS_SCENARIO |
| `SUBPRIME.financial_health_shift` | -0.8 | additive | Hand-chosen | | | | | STRESS_SCENARIO |
| `SUBPRIME.credit_score_cap` | 680 | cap | Hand-chosen | | | `min(score, 680)` | Creates a point mass at 680. | STRESS_SCENARIO |
| `SUBPRIME.max_dti_ratio` | 0.55 | cap | Hand-chosen | | | `min(0.55, dti_ratio.scale_max=0.50)` = 0.50 | **No effect**: the code takes the smaller of this and the global 0.50 ceiling. | STRESS_SCENARIO |
| `SELF_EMPLOYED.income_gini_multiplier` | 1.6 | multiplier on lognormal shape | Hand-chosen to widen income dispersion | | | | | STRESS_SCENARIO |
| `SELF_EMPLOYED.tenure_rate_multiplier` | 0.6 | multiplier on exponential rate | Hand-chosen; lengthens mean tenure to 47.6 months | | | | Self-employed applicants are also given a fixed `Professional Services` industry and an `LLC` employer name. | STRESS_SCENARIO |
| `SELF_EMPLOYED.employment_label` | "Self-Employed" | label | | | | **not read by code** | Dead parameter (`employment_status` is always `ACTIVE`). | STRESS_SCENARIO |

## geography

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `probabilities` | HIGH 0.25, MEDIUM 0.50, LOW 0.25 | categorical | Hand-chosen | | | | Not weighted by population or origination volume. | SIMPLIFYING_ASSUMPTION |
| `zip_prefixes` | HIGH: 90, 10, 94, 02, 98, 60, 77; MEDIUM: 30, 75, 85, 55, 80, 28, 12; LOW: 37, 64, 71, 88, 40, 66, 31 | uniform choice | Two-digit prefixes chosen to evoke real metros (e.g. 90 Los Angeles, 10 New York, 94 San Francisco, 02 Boston, 98 Seattle) | | | prefix + 4 random digits | The generated string has 6 characters, not 5, because the suffix is padded to 4 digits; the "zip3" audit attribute therefore covers prefix plus one random digit. Prefix-to-cost mapping is a caricature (77 Houston is not high-cost by most indices). | SIMPLIFYING_ASSUMPTION |
| `cost_of_living_index` | 1.42 / 1.05 / 0.84 | index | APPROXIMATE - not yet verified against source. Check BEA Regional Price Parities. | | | copied to case; no behavioural use | Not used in any calculation. | SIMPLIFYING_ASSUMPTION |
| `rent_multiplier` | 1.65 / 1.05 / 0.72 | multiplier | Hand-chosen | | | on uniform 1000-2200 base rent | Check HUD Fair Market Rents or Census ACS median gross rent by metro. | SIMPLIFYING_ASSUMPTION |
| `salary_multiplier` | 1.22 / 1.00 / 0.88 | multiplier | Hand-chosen | | | on persona median and bounds | Check BLS OEWS metro-area wage differentials. | SIMPLIFYING_ASSUMPTION |
| `checking_multiplier` | 1.15 / 1.00 / 0.88 | multiplier | Hand-chosen | | | on checking balance | | SIMPLIFYING_ASSUMPTION |

## loan

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `interest_rate` | 0.0675 | constant | APPROXIMATE - not yet verified against source. Should be tied to the Freddie Mac Primary Mortgage Market Survey 30-year fixed average for the as-of date; 6.75% is within the range observed in 2023-2025 but no specific week is claimed. | none stated | 30-year fixed conforming | monthly amortisation formula | Same rate for every applicant regardless of score, LTV or date; no rate drift. | SIMPLIFYING_ASSUMPTION |
| `term_years` | 30 | constant | Most common US mortgage term | | | | No 15-year or ARM products. | SIMPLIFYING_ASSUMPTION |
| `tax_insurance_rate` | 0.015 | annual share of loan amount | Hand-chosen proxy for property tax plus hazard insurance | | | `loan x 0.015 / 12` added to P&I | Taxes and insurance are levied on property value, not loan amount; there is no property value in the model. Check Census ACS effective property tax rates and NAIC homeowners insurance averages. | SIMPLIFYING_ASSUMPTION |
| loan amount rule (hard-coded) | 3.0 x stated salary | constant | Hard-coded in `generateCase` | | | `floor(salary x 3)` | No LTV, no property value, no borrower choice. | SIMPLIFYING_ASSUMPTION |

## underwriting

These thresholds define the policy that produces labels. They are not observed outcomes.

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `dti.approve_max` | 0.38 | threshold | Hand-chosen; conservative relative to agency guides (Fannie Mae Selling Guide DU maximum 50%, manual underwriting 36% base with extensions to 45%). | | | back-end DTI on verified income and max(disclosed, bureau) obligations | Should be reconciled with the Fannie Mae Selling Guide B3-6-02 and with the 43% QM reference. | SIMPLIFYING_ASSUMPTION |
| `dti.manual_review_max` | 0.47 | threshold | Hand-chosen | | | | | SIMPLIFYING_ASSUMPTION |
| `credit_score.approve_min` | 640 | threshold | Hand-chosen; above the Fannie Mae minimum representative score of 620 for most loans. | | | truth credit score (not the bureau evidence value) | The engine reads `truth.credit_score`, not `evidence.CREDIT_BUREAU.credit_score`. | SIMPLIFYING_ASSUMPTION |
| `credit_score.manual_review_min` | 600 | threshold | Hand-chosen | | | | | SIMPLIFYING_ASSUMPTION |
| `reserves.approve_min_months` | 0.25 | months of gross income | Hand-chosen | | | bank balance / gross monthly income | Agency reserve requirements are expressed in months of PITI, not gross income, and range from 0 to 6 months by occupancy and product (Fannie Mae Selling Guide B3-4.1-01). 0.25 months is far below any of those. | SIMPLIFYING_ASSUMPTION |
| `reserves.manual_review_min_months` | 0.1 | months | Hand-chosen | | | | | SIMPLIFYING_ASSUMPTION |
| `tenure.approve_min_months` | 12 | months | Hand-chosen; agency guidance is a two-year employment history with exceptions (Fannie Mae Selling Guide B3-3.1-01). | | | claimed tenure | Tenure is measured to 2024-01-01. | SIMPLIFYING_ASSUMPTION |
| `tenure.manual_review_min_months` | 6 | months | Hand-chosen | | | | | SIMPLIFYING_ASSUMPTION |
| strong/low thresholds (hard-coded) | reserves >= 2.0 months, DTI <= 30%, tenure >= 24 months, score >= 720 | | Hard-coded in `computeDecision`; affect only the reason string | | | | Not in config. | SIMPLIFYING_ASSUMPTION |

## corruption

The legacy scalar keys are not read; only `blend` is.

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `omission_prob`, `benign_variance_prob`, `clean_prob`, `concealment_prob`, `fabrication_prob`, `inflation_prob`, `bust_out_prob` | 0.08, 0.15, 0.60, 0.05, 0.03, 0.05, 0.02 | | Legacy | | | **not read by code** | Dead parameters. | FRAUD_INJECTION |
| `blend.clean` | 0.79 | categorical (cumulative) | Hand-chosen | | | 21% of blended cases are non-clean | Industry mortgage fraud incidence is far lower (CoreLogic Mortgage Fraud Report reports fraud risk on the order of 1 in 100-150 applications). The generator deliberately over-samples fraud for training and evaluation. | FRAUD_INJECTION |
| `blend.concealment` | 0.06 | | Hand-chosen | | | severity MEDIUM or HIGH, 50/50 | | FRAUD_INJECTION |
| `blend.inflation` | 0.04 | | Hand-chosen | | | severity always MEDIUM (10% overstatement, so always in the re-underwrite tier) | HIGH (20%) inflation is never produced by the blend. | FRAUD_INJECTION |
| `blend.fabrication` | 0.03 | | Hand-chosen | | | severity HIGH | | FRAUD_INJECTION |
| `blend.bust_out` | 0.01 | | Hand-chosen | | | severity HIGH | | FRAUD_INJECTION |
| `blend.evidence_tampering` | 0.02 | | Hand-chosen | | | MEDIUM or HIGH | | FRAUD_INJECTION |
| `blend.occupancy_misrepresentation` | 0.01 | | Hand-chosen | | | MEDIUM | | FRAUD_INJECTION |
| `blend.gift_fund_misrepresentation` | 0.01 | | Hand-chosen | | | MEDIUM | | FRAUD_INJECTION |
| `blend.asset_seasoning` | 0.01 | | Hand-chosen | | | MEDIUM | | FRAUD_INJECTION |
| `blend.straw_buyer` | 0.01 | | Hand-chosen | | | HIGH | | FRAUD_INJECTION |
| `blend.incoherent` | 0.01 | | Hand-chosen; negative control, not fraud | | | HIGH | | STRESS_SCENARIO |
| severity multipliers (hard-coded) | INFLATION 5/10/20%; EVIDENCE_TAMPERING balance 20/35/50%; gift 35/60% of salary; seasoning 30/50% of salary; straw buyer 50% of salary; FABRICATION salary U(120k,180k), checking U(40k,80k); BUST_OUT salary U(110k,160k), score U(720,780), checking U(35k,70k) | | Hard-coded in `src/core/corruption.js` | | | | Not in config. | FRAUD_INJECTION |

## adversarial

Disabled by default. When enabled, corruption type is chosen to target cases near decision boundaries.

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `enabled` | false | flag | | | | | | STRESS_SCENARIO |
| `adversarial_rate` | 0.70 | bernoulli | Hand-chosen | | | share of eligible cases that get corrupted | Much higher than any realistic incidence. | STRESS_SCENARIO |
| `inflation_dti_min` / `max` | 0.36 / 0.47 | window on truth `dti` | Hand-chosen to bracket the approve/manual boundary | | | | Compares the front-end `dti` sample, not the back-end DTI the policy uses. | STRESS_SCENARIO |
| `concealment_dti_threshold` | 0.40 | threshold | Hand-chosen | | | | | STRESS_SCENARIO |
| `fabrication_credit_threshold` | 620 | threshold | Hand-chosen | | | | | STRESS_SCENARIO |
| `weights` | inflation 1.5, concealment 1.0, fabrication 1.0 | relative weights | Hand-chosen | | | | Only three of the ten typologies can be targeted. | STRESS_SCENARIO |

## metadata

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `fraud_signal_rate` | 0.6 (config and code default) | bernoulli per fraud case | Modelling assumption stated in `src/core/metadata.js`: "real fraud does not always come from a Tor exit node" | | | if the draw succeeds, all device, behaviour and document-age distributions switch to the fraud versions | The 40% of fraud cases without signals have metadata identical in distribution to clean cases; the 60% with signals are nearly separable from clean cases. No public series exists for this; it must remain a stated assumption. | FRAUD_INJECTION |
| device/behaviour distributions (hard-coded) | see DATA_DICTIONARY `application_metadata` | | Hard-coded | | | | Not in config. No source; not calibrated to any device-intelligence vendor data. | FRAUD_INJECTION |

## generation

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `as_of_date` | null (today) | constant | | | | drives `submitted`, evidence dates, ledger months, metadata document dates | Life-script events remain anchored to 2024-01-01 regardless. | SIMPLIFYING_ASSUMPTION |

## fairness

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `scenario_attributes.family_status_probabilities` | SINGLE 0.35, MARRIED 0.35, WITH_DEPENDENTS 0.22, SINGLE_PARENT 0.08 | categorical | Hand-chosen scenario mix; sampled independently of every financial variable by construction | | | audit attribute only | Not a census household composition; deliberately not linked to anything so that any association with outcomes is a defect. Check Census CPS household composition only if the mix itself matters. | SIMPLIFYING_ASSUMPTION |
| `scenario_attributes.disability_income_scenario_rate` | 0.04 | bernoulli | Hand-chosen | | | audit attribute only | Scenario label; no income component is actually generated for it. | SIMPLIFYING_ASSUMPTION |

## performance

The loan-performance simulation (`src/simulation/performance.js`) that produces the observed outcome label. Read from `config.performance`, with the same values hard-coded as `DEFAULT_PERFORMANCE_CONFIG` in that module. Every row here is a modelling assumption; none is fitted, and the two `intent_default` rows assert fraud behaviour rather than model it. See STATISTICAL_ASSUMPTIONS section 13 for the mechanics.

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `horizon_months` | 36 | constant | Hand-chosen observation window, long enough for early-life mortgage defaults to appear and short enough to keep the simulation cheap | none stated | funded mortgages | loop length; `performance.horizon_months` | Truncates well before the peak default hazard of a 30-year mortgage, so lifetime default and loss are understated by construction. Cumulative 36-month rates could be compared with Fannie Mae or Freddie Mac single-family loan performance data by origination cohort. APPROXIMATE - not yet verified against source. | SIMPLIFYING_ASSUMPTION |
| `months_missed_to_default` | 3 | constant | The 90-days-past-due convention used for serious delinquency in mortgage reporting | none stated | funded mortgages | 3 consecutive missed payments terminate the case in `DEFAULT` | Consecutive misses only: no roll rates, no self-cure, no forbearance or modification. Realised serious-delinquency and default rates should be checked against the Mortgage Bankers Association National Delinquency Survey and FHFA / Fannie Mae / Freddie Mac credit performance data. APPROXIMATE - not yet verified against source. | SIMPLIFYING_ASSUMPTION |
| `discretionary_compression_floor` | 0.55 | multiplier | Hand-chosen: households cut discretionary spending before missing a mortgage payment | none stated | stressed households | discretionary spend x 0.55 when reserves are below one PITI or income is interrupted | A single fixed cut with no gradation by severity or duration. BLS Consumer Expenditure Survey could bound how much of a household budget is genuinely compressible. APPROXIMATE - not yet verified against source. | SIMPLIFYING_ASSUMPTION |
| `reserve_share_available` | 0.85 | multiplier | Hand-chosen haircut for cash that is nominally in the account but not reachable in the month it is needed | none stated | borrowers at closing | `(checking_balance - down_payment) x 0.85` | Arbitrary. No savings, retirement or brokerage assets exist in the model, so this haircut is applied to the only account there is. | SIMPLIFYING_ASSUMPTION |
| `income_volatility.stable` | 0.03 | normal (monthly multiplicative sd) | Hand-chosen by `tenure_stability` class | none stated | salaried employees | `income x (1 + N(0, 0.03))` each month | Salaried pay is usually far less variable than 3 percent month to month; the ledger elsewhere uses 2 percent. | SIMPLIFYING_ASSUMPTION |
| `income_volatility.recent` | 0.05 | normal | Hand-chosen | none stated | recently hired employees | as above | No source; tenure does not in itself make pay variable. | SIMPLIFYING_ASSUMPTION |
| `income_volatility.seasonal` | 0.14 | normal | Hand-chosen | none stated | seasonal workers | as above | Real seasonality is a periodic pattern, not white noise. | SIMPLIFYING_ASSUMPTION |
| `income_volatility.variable` | 0.20 | normal | Hand-chosen | none stated | commission or variable-pay workers | as above | As above; the `tenure_stability` label is a persona attribute with no other behavioural effect. | SIMPLIFYING_ASSUMPTION |
| `self_employed_volatility_multiplier` | 1.5 | multiplier | Hand-chosen; self-employment income is more variable than salaried income | none stated | SELF_EMPLOYED regime | multiplies the class volatility above | Magnitude has no source. | SIMPLIFYING_ASSUMPTION |
| `job_loss.base_monthly_prob` | 0.004 | bernoulli per month | Hand-chosen baseline monthly hazard of an income interruption | none stated | employed borrowers | scaled by credit and tenure factors, clamped to [0, 0.08] | Should be checked against BLS Job Openings and Labor Turnover Survey separation and layoff rates, converted to a monthly involuntary-separation hazard. APPROXIMATE - not yet verified against source. | SIMPLIFYING_ASSUMPTION |
| `job_loss.credit_score_pivot` | 700 | pivot | Hand-chosen | none stated | | `1 + ((700 - score) / 100) x slope` | Credit score is used as a proxy for employment fragility, which is not a causal relationship; any real association runs through the same latent factor that produced the score. | SIMPLIFYING_ASSUMPTION |
| `job_loss.credit_score_slope` | 0.9 | slope per 100 points | Hand-chosen | none stated | | multiplies the base hazard, floored at 0.25 | A score 100 points below the pivot nearly doubles the hazard. No source for that gradient. | SIMPLIFYING_ASSUMPTION |
| `job_loss.tenure_protection_months` | 24 | threshold | Hand-chosen; last in, first out | none stated | | hazard x 0.7 at or above 24 months, x 1.35 below | Step function at exactly two years; BLS tenure and separation data could inform a smooth profile. APPROXIMATE - not yet verified against source. | SIMPLIFYING_ASSUMPTION |
| `job_loss.duration_months.min` / `max` | 1 / 5 | uniform integer | Hand-chosen | none stated | | months of interrupted income | Should be checked against BLS duration of unemployment (median and mean weeks). APPROXIMATE - not yet verified against source. | SIMPLIFYING_ASSUMPTION |
| `job_loss.income_retained` | 0.35 | multiplier | Hand-chosen stand-in for unemployment insurance or partial replacement work | none stated | | `income x 0.35` while interrupted | State UI replacement rates vary widely and are capped in dollars, not as a share of prior income. | SIMPLIFYING_ASSUMPTION |
| `expense_shock.monthly_prob` | 0.02 | bernoulli per month | Hand-chosen | none stated | all households | draws a one-off outflow in the month | No source; roughly one shock every four years per household. | SIMPLIFYING_ASSUMPTION |
| `expense_shock.share_of_monthly_income` | 0.6 | multiplier | Hand-chosen | none stated | all households | `monthly_net_income x 0.6` added to that month's outflow | Sized off income rather than off the actual cost of the event; independent of household size or health. | SIMPLIFYING_ASSUMPTION |
| `intent_default.BUST_OUT` | 0.85 | bernoulli | Asserted, not modelled. Bust-out damage is intent, not capacity, and no cash-flow simulation can express an applicant who never intended to pay. | none stated | injected `BUST_OUT` cases | on success the case defaults in month 1, 2 or 3 and the cash-flow loop is skipped | This is the outcome label being written directly from the injection label for these cases. Any model that separates `BUST_OUT` on outcome is partly recovering the injection. No public series can validate it. | FRAUD_INJECTION |
| `intent_default.STRAW_BUYER` | 0.55 | bernoulli | Asserted, not modelled, as above | none stated | injected `STRAW_BUYER` cases | as above | As above. The gap between 0.85 and 0.55 is a hand-chosen ordering, not a measured one. | FRAUD_INJECTION |
| `gift_fund_repayment_share` | 0.02 | multiplier | Hand-chosen: an undisclosed gift is really a loan, repaid monthly at 2 percent of the balance | none stated | `GIFT_FUND_MISREPRESENTATION` cases | added to true monthly obligations | 2 percent of balance is a convention borrowed from the 1 percent student-loan payment rule, with no source of its own. | SIMPLIFYING_ASSUMPTION |
| `loss_given_default.base` | 0.22 | share of loan | Hand-chosen severity before foreclosure costs | none stated | defaulted mortgages | part of the LGD sum | Should be checked against GSE loss-given-default and loss-severity disclosures (Fannie Mae and Freddie Mac credit risk transfer and single-family loan performance data). APPROXIMATE - not yet verified against source. | SIMPLIFYING_ASSUMPTION |
| `loss_given_default.foreclosure_cost_share` | 0.08 | share of loan | Hand-chosen direct cost of the foreclosure process | none stated | defaulted mortgages | added to `base` | As above; real foreclosure cost varies substantially by state timeline. APPROXIMATE - not yet verified against source. | SIMPLIFYING_ASSUMPTION |
| `loss_given_default.home_price_drift_monthly` | 0.0025 | geometric drift | Hand-chosen, about 3 percent a year | none stated | national house prices | compounded over months to default; appreciation reduces the loss | Should be checked against the FHFA House Price Index or S&P CoreLogic Case-Shiller. Always positive, so no borrower ever defaults into a falling market. APPROXIMATE - not yet verified against source. | SIMPLIFYING_ASSUMPTION |
| `loss_given_default.home_price_volatility_monthly` | 0.012 | normal | Hand-chosen | none stated | national house prices | monthly shock on the price path | Independent across cases, so there is no correlated downturn and portfolio tail risk is far too low. | SIMPLIFYING_ASSUMPTION |
| `loss_given_default.min` / `max` | 0.02 / 0.65 | bounds | Hand-chosen | none stated | | clamp on the computed LGD | Creates point masses at both bounds. | SIMPLIFYING_ASSUMPTION |
| equity build (hard-coded) | `min(0.06, months x 0.0012)` | linear | Hard-coded in `lossGivenDefault` | | | subtracted from LGD | Not in config. A linear stand-in for amortisation, not the actual 30-year schedule at the configured 6.75 percent rate. | SIMPLIFYING_ASSUMPTION |

## value_assumptions

Economics used by the outcome evaluation (`DEFAULT_VALUE_ASSUMPTIONS` in `src/evaluation/outcome/index.js`) to price a policy's decisions against simulated performance. They are overridable through `config.value_assumptions`, which the shipped config does not set. They affect the portfolio-value comparison and the `policy_beats_decline_all` gate only; they do not affect generation.

| Parameter | Value | Distribution | Source or justification | Applicable year | Population represented | Transformation applied | Known limitation | Provenance class |
|---|---|---|---|---|---|---|---|---|
| `margin_on_performing` | 0.03 | share of loan amount | Hand-chosen lifetime net margin on a loan that performs over the simulated horizon; stated in the source as a modelling assumption, not a fitted value | none stated | funded mortgages | `loan_amount x 0.03` earned on every non-defaulted funded loan | Not a spread, not discounted, and not sensitive to rate, term or prepayment. Mortgage banking income could be bounded from MBA or public originator disclosures but no figure is claimed here. APPROXIMATE - not yet verified against source. | SIMPLIFYING_ASSUMPTION |
| `manual_review_cost` | 250 | USD per application | Hand-chosen cost of putting one application through manual underwriting | none stated | reviewed applications | `reviewed count x 250` subtracted from policy net value | Flat per-case cost with no dependence on review depth or analyst time; the model card's separate 45-minutes-per-review figure is a different assumption in a different module. | SIMPLIFYING_ASSUMPTION |
| `origination_cost` | 900 | USD per funded loan | Hand-chosen cost of originating any funded loan | none stated | funded mortgages | `funded count x 900` subtracted from net value | Per-loan origination cost is reported in the MBA quarterly mortgage bankers performance report; this value has not been checked against it. APPROXIMATE - not yet verified against source. | SIMPLIFYING_ASSUMPTION |

## Summary of dead or ineffective parameters

| Parameter | Status |
|---|---|
| `employment.employment_gap_prob` | sampled, result discarded |
| `employment.industry.*` | fallback only; every persona overrides |
| `personas.*.student_loan_prob` | never read |
| `personas.*.tenure_stability` | no longer dead: read by the performance simulation to pick income volatility |
| `liabilities.credit_card_utilization` | never read |
| `credit.inquiry_count` | never read |
| `expenses.rent_to_income_gross_ratio` | never read; rent is uniform 1000-2200 x regional multiplier |
| `ledger.max_negative_balance_months` | never read |
| `ledger.overdraft_fee` | recorded, never debited |
| `regimes.SUBPRIME.max_dti_ratio` | 0.55 exceeds the global 0.50 ceiling, so it never binds |
| `regimes.SELF_EMPLOYED.employment_label` | never read |
| `corruption.*_prob`, `clean_prob`, `omission_prob`, `benign_variance_prob` | legacy, never read |
| `geography.*.cost_of_living_index` | copied, never used in a calculation |
| `assets.savings_rate`, `assets.down_payment_months` | feed `down_payment`, which no decision reads; the performance simulation reads it to set reserves at closing |
