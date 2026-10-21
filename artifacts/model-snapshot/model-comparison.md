# Model comparison
| model | backend | threshold | pr_auc | roc_auc | precision | recall | f1 | fpr | ece | brier |
|---|---|---|---|---|---|---|---|---|---|---|
| rules_baseline | deterministic-rules | 0.26 | 0.976 | 0.993 | 0.946 | 0.992 | 0.969 | 0.014 | 0.040 | 0.018 |
| logistic_regression | sklearn | 0.30 | 0.989 | 0.992 | 1.000 | 0.972 | 0.986 | 0.000 | 0.033 | 0.008 |
| random_forest | sklearn | 0.21 | 0.995 | 0.997 | 1.000 | 0.992 | 0.996 | 0.000 | 0.033 | 0.005 |
| gradient_boosting | lightgbm | 0.03 | 0.993 | 0.996 | 1.000 | 0.988 | 0.994 | 0.000 | 0.002 | 0.002 |

## Robustness across splits (PR-AUC)
| model | test | out_of_time | geography_stress | economic_regime_stress | adversarial_fraud | clean-control FPR |
|---|---|---|---|---|---|---|
| rules_baseline | 0.976 | 0.958 | 0.973 | 0.948 | 1.000 | 0.003 |
| logistic_regression | 0.989 | 0.977 | 0.985 | 0.972 | 0.995 | 0.000 |
| random_forest | 0.995 | 0.985 | 0.988 | 0.976 | 1.000 | 0.001 |
| gradient_boosting | 0.993 | 0.984 | 0.989 | 0.976 | 1.000 | 0.000 |

## Why the champion wins
random_forest (sklearn) reaches test PR-AUC 0.995 and ROC-AUC 0.997 at threshold 0.21 (recall 0.992, FPR 0.000). Against the rules baseline (PR-AUC 0.976) the gain is +0.019: the rules emit a small set of discrete scores, so they cannot rank cases within a severity tier, and every threshold below a HIGH rule trades recall for the same false positives. A learned model ranks continuously. It outperforms logistic regression (PR-AUC 0.989, +0.006). The fraud signal is conjunctive and non-linear: a claimed-versus-bureau score gap only matters together with a clustered thin file, unsourced deposits only matter relative to income, and metadata risk is informative only above a threshold. Tree ensembles model those interactions and thresholds directly; a linear model has to approximate them with additive effects. Robustness: out-of-time PR-AUC 0.985 under a rate shock and adversarial PR-AUC 1.000 where fraud is placed among marginal applicants; the drop versus test, if any, is the price of relying on discrepancy features whose base rates shift with the population. Calibration: ECE 0.033 and Brier 0.005; scores are usable as probabilities for the decision-economics simulator without post-hoc recalibration if ECE stays under 0.05. The margin over the runner-up is small; the champion is preferred on the tie-break of out-of-time PR-AUC, and both should be kept as champion/challenger.

## Recall by fraud type (champion, test)
| fraud type | n | recall |
|---|---|---|
| ASSET_SEASONING | 9 | 1.000 |
| BUST_OUT | 10 | 1.000 |
| CONCEALMENT | 81 | 1.000 |
| EVIDENCE_TAMPERING | 25 | 1.000 |
| FABRICATION | 40 | 1.000 |
| GIFT_FUND_MISREPRESENTATION | 7 | 1.000 |
| INCOHERENT | 12 | nan |
| INFLATION | 49 | 1.000 |
| NONE | 987 | nan |
| OCCUPANCY_MISREPRESENTATION | 8 | 0.750 |
| STRAW_BUYER | 19 | 1.000 |
