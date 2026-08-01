import React, { useState } from "react";
import CONFIG from "./distribution_config.json";
import { generateCase, generateBlendedCase, calculateStatistics, casesToCsv } from "./generator";

// ─── 1. INITIAL CASES ──────────────────────────────────────
const INITIAL_CASES = [
  {
    "id": "case-001",
    "applicant": {
      "name": "Robert Martinez",
      "age": 35,
      "ssn_last4": "9223",
      "zip_code": "804626",
      "region": "MEDIUM_COST"
    },
    "application": {
      "loan_type": "MORTGAGE",
      "loan_amount": 454118,
      "purpose": "PURCHASE",
      "submitted": "2026-07-31"
    },
    "application_metadata": {
      "submitted": "2026-07-30T18:26:00.000Z",
      "hour_of_day": 14,
      "day_of_week": 5,
      "is_business_hours": 1,
      "device_fingerprint": "f212952112a25dc5fe767c119d06a943",
      "ip_address": "158.156.36.77",
      "ip_risk_score": 0.226,
      "is_vpn": 0,
      "is_tor": 0,
      "isp": "Verizon",
      "typing_speed_wpm": 67,
      "fields_copy_pasted": 2,
      "session_duration_seconds": 442,
      "used_autofill": 1,
      "documents": [
        {
          "source": "W2_DOCUMENT",
          "created": "2026-02-10",
          "modified": "2026-02-10",
          "pdf_generator": "Microsoft Print to PDF",
          "days_before_submission": 171
        },
        {
          "source": "BANK_STATEMENT",
          "created": "2026-02-20",
          "modified": "2026-02-21",
          "pdf_generator": "Microsoft Print to PDF",
          "days_before_submission": 161
        },
        {
          "source": "CREDIT_BUREAU",
          "created": "2026-02-02",
          "modified": "2026-02-02",
          "pdf_generator": "Chrome PDF Generator",
          "days_before_submission": 179
        },
        {
          "source": "EMPLOYER_VERIFICATION",
          "created": "2026-02-21",
          "modified": "2026-02-21",
          "pdf_generator": "Adobe PDF Library",
          "days_before_submission": 160
        }
      ]
    },
    "truth": {
      "entityId": "gen-0",
      "demographics": {
        "age": 35,
        "ssn_last4": "9223",
        "zip_code": "804626",
        "region": "MEDIUM_COST"
      },
      "events": [
        {
          "t": "2022-10-01",
          "type": "EMPLOYMENT_START",
          "entity": "Other Corp",
          "salary": 129748
        },
        {
          "t": "2023-01-01",
          "type": "LIABILITY_OPENED",
          "type_detail": "AUTO_LOAN",
          "payment": 595
        },
        {
          "t": "2021-02-01",
          "type": "ADDRESS_CHANGE",
          "type_detail": "RENTED",
          "address": "6085 Maple Dr",
          "monthly_payment": 2263
        }
      ],
      "current_state": {
        "employment_status": "ACTIVE",
        "employer": "Other Corp",
        "industry": "Other",
        "persona": "ENTREPRENEUR",
        "tenure_stability": "variable",
        "salary": 129748,
        "tenure_months": 15,
        "checking_balance": 23103,
        "monthly_obligations": 1278,
        "dti": 0.11817641977878929,
        "credit_score": 646,
        "down_payment": 25355,
        "regime": "PRIME",
        "region": "MEDIUM_COST",
        "zip_code": "804626",
        "cost_of_living_index": 1.05,
        "housing_history": [
          {
            "t": "2021-02-01",
            "type": "ADDRESS_CHANGE",
            "type_detail": "RENTED",
            "address": "6085 Maple Dr",
            "monthly_payment": 2263
          }
        ],
        "income_stream": {
          "gross_annual_salary": 129748,
          "pay_frequency": "BIWEEKLY",
          "checks_per_year": 26,
          "gross_per_check": 4990,
          "pretax_deduction_rate": 0.225,
          "net_per_check": 3868,
          "annual_w2_wages": 100560,
          "monthly_net_deposit": 8381
        },
        "expense_obligations": {
          "rent": 2263,
          "utilities": 216,
          "liabilities": 1278,
          "discretionary": 1064,
          "total_monthly": 4821
        },
        "monthly_ledger": [
          {
            "month": "2026-05",
            "salary_deposits": 8117,
            "rent_paid": 2263,
            "utilities_paid": 216,
            "liability_payments": 1278,
            "discretionary_spent": 1080,
            "total_outflows": 4837,
            "starting_checking_balance": 12638,
            "ending_checking_balance": 15918,
            "events": []
          },
          {
            "month": "2026-07",
            "salary_deposits": 8300,
            "rent_paid": 2263,
            "utilities_paid": 216,
            "liability_payments": 1278,
            "discretionary_spent": 868,
            "total_outflows": 4625,
            "starting_checking_balance": 15918,
            "ending_checking_balance": 19593,
            "events": []
          },
          {
            "month": "2026-07",
            "salary_deposits": 8186,
            "rent_paid": 2263,
            "utilities_paid": 216,
            "liability_payments": 1278,
            "discretionary_spent": 919,
            "total_outflows": 4676,
            "starting_checking_balance": 19593,
            "ending_checking_balance": 23103,
            "events": []
          }
        ],
        "overdraft_count": 0,
        "annual_w2_wages": 100560,
        "monthly_mortgage_payment": 3475,
        "loan_amount": 454118,
        "backend_dti": 0.4395905909917686
      }
    },
    "presentation": {
      "entityId": "gen-0",
      "demographics": {
        "age": 35,
        "ssn_last4": "9223",
        "zip_code": "804626",
        "region": "MEDIUM_COST"
      },
      "events": [
        {
          "t": "2022-10-01",
          "type": "EMPLOYMENT_START",
          "entity": "Other Corp",
          "salary": 129748
        },
        {
          "t": "2023-01-01",
          "type": "LIABILITY_OPENED",
          "type_detail": "AUTO_LOAN",
          "payment": 595
        },
        {
          "t": "2021-02-01",
          "type": "ADDRESS_CHANGE",
          "type_detail": "RENTED",
          "address": "6085 Maple Dr",
          "monthly_payment": 2263
        }
      ],
      "current_state": {
        "employment_status": "ACTIVE",
        "employer": "Other Corp",
        "industry": "Other",
        "persona": "ENTREPRENEUR",
        "tenure_stability": "variable",
        "salary": 129748,
        "tenure_months": 15,
        "checking_balance": 23103,
        "monthly_obligations": 1278,
        "dti": 0.11817641977878929,
        "credit_score": 646,
        "down_payment": 25355,
        "regime": "PRIME",
        "region": "MEDIUM_COST",
        "zip_code": "804626",
        "cost_of_living_index": 1.05,
        "housing_history": [
          {
            "t": "2021-02-01",
            "type": "ADDRESS_CHANGE",
            "type_detail": "RENTED",
            "address": "6085 Maple Dr",
            "monthly_payment": 2263
          }
        ],
        "income_stream": {
          "gross_annual_salary": 129748,
          "pay_frequency": "BIWEEKLY",
          "checks_per_year": 26,
          "gross_per_check": 4990,
          "pretax_deduction_rate": 0.225,
          "net_per_check": 3868,
          "annual_w2_wages": 100560,
          "monthly_net_deposit": 8381
        },
        "expense_obligations": {
          "rent": 2263,
          "utilities": 216,
          "liabilities": 1278,
          "discretionary": 1064,
          "total_monthly": 4821
        },
        "monthly_ledger": [
          {
            "month": "2026-05",
            "salary_deposits": 8117,
            "rent_paid": 2263,
            "utilities_paid": 216,
            "liability_payments": 1278,
            "discretionary_spent": 1080,
            "total_outflows": 4837,
            "starting_checking_balance": 12638,
            "ending_checking_balance": 15918,
            "events": []
          },
          {
            "month": "2026-07",
            "salary_deposits": 8300,
            "rent_paid": 2263,
            "utilities_paid": 216,
            "liability_payments": 1278,
            "discretionary_spent": 868,
            "total_outflows": 4625,
            "starting_checking_balance": 15918,
            "ending_checking_balance": 19593,
            "events": []
          },
          {
            "month": "2026-07",
            "salary_deposits": 8186,
            "rent_paid": 2263,
            "utilities_paid": 216,
            "liability_payments": 1278,
            "discretionary_spent": 919,
            "total_outflows": 4676,
            "starting_checking_balance": 19593,
            "ending_checking_balance": 23103,
            "events": []
          }
        ],
        "overdraft_count": 0,
        "annual_w2_wages": 100560,
        "monthly_mortgage_payment": 3475,
        "loan_amount": 454118,
        "backend_dti": 0.4395905909917686
      }
    },
    "evidence": [
      {
        "source": "W2_DOCUMENT",
        "date": "2026-07-31",
        "fields": {
          "w2_wages": 98698,
          "employer": "Other Corp",
          "tax_year": 2024
        },
        "fidelity": 0.9748566391856176
      },
      {
        "source": "EMPLOYER_VERIFICATION",
        "date": "2026-07-31",
        "fields": {
          "employer": "Other Corp",
          "salary": 129748,
          "net_per_check": 3868,
          "pay_frequency": "BIWEEKLY",
          "status": "ACTIVE",
          "hire_date": "2022-10-01",
          "tenure_stability": "variable"
        },
        "fidelity": 0.9650530974137428
      },
      {
        "source": "BANK_STATEMENT",
        "date": "2026-07-31",
        "fields": {
          "checking_balance": 22989,
          "recurring_debits": [
            {
              "payee": "Auto Finance",
              "amount": 595
            },
            {
              "payee": "Property Management",
              "amount": 2263
            },
            {
              "payee": "Utility Providers",
              "amount": 216
            }
          ],
          "monthly_payroll_deposit": 8201,
          "rent_payments": [
            {
              "month": "2026-05",
              "amount": 2263
            },
            {
              "month": "2026-07",
              "amount": 2263
            },
            {
              "month": "2026-07",
              "amount": 2263
            }
          ],
          "overdraft_count": 0,
          "recent_large_deposits": [],
          "months_of_statements": 3
        },
        "fidelity": 0.9756253219004105
      },
      {
        "source": "CREDIT_BUREAU",
        "date": "2026-07-31",
        "fields": {
          "credit_score": 659,
          "open_accounts": 5,
          "liabilities": [
            {
              "type": "AUTO_LOAN",
              "payment": 595
            }
          ],
          "persona": "ENTREPRENEUR"
        },
        "fidelity": 0.9911880868063353
      },
      {
        "source": "RENT_VERIFICATION",
        "date": "2026-07-31",
        "fields": {
          "current_address": "6085 Maple Dr",
          "monthly_rent": 2263,
          "lease_start": "2021-02-01",
          "payment_history": "CURRENT"
        },
        "fidelity": 0.9819667900439268
      },
      {
        "source": "GEOGRAPHIC_VERIFICATION",
        "date": "2026-07-31",
        "fields": {
          "zip_code": "804626",
          "region": "MEDIUM_COST",
          "cost_of_living_index": 1.05
        },
        "fidelity": 0.9610661347193457
      }
    ],
    "alignment_findings": [
      {
        "dimension": "identity",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Applicant name, age, and SSN are consistent across application and evidence."
      },
      {
        "dimension": "employment",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Employer Other Corp verified."
      },
      {
        "dimension": "income",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Self-reported $129,748 matches verified income $129,748."
      },
      {
        "dimension": "assets",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Self-reported checking $23,103 matches bank statement $22,989."
      },
      {
        "dimension": "liabilities",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Application liabilities match credit bureau (1 accounts, $1278/mo)."
      },
      {
        "dimension": "address",
        "level": "A0",
        "status": "NOT_VERIFIED",
        "details": "Address data not collected in current model; assumed consistent."
      },
      {
        "dimension": "timeline",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Employment and liability timeline is consistent."
      },
      {
        "dimension": "cash_flow",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Cash flow supports disclosed obligations and proposed mortgage with comfortable residual income."
      },
      {
        "dimension": "affordability",
        "level": "A3",
        "status": "ELEVATED_DTI",
        "details": "Back-end DTI 44.0% (PITI $3,475) is elevated."
      },
      {
        "dimension": "document_metadata",
        "level": "A0",
        "status": "DOCUMENT_AGES_NORMAL",
        "details": "Supporting documents have plausible ages."
      },
      {
        "dimension": "network",
        "level": "A0",
        "status": "IP_TRUSTED",
        "details": "IP origin is low-risk and not anonymized."
      },
      {
        "dimension": "behavioral",
        "level": "A0",
        "status": "BUSINESS_HOURS",
        "details": "Submitted during normal business hours."
      },
      {
        "dimension": "behavioral",
        "level": "A1",
        "status": "SOME_COPY_PASTE",
        "details": "2 fields were copy-pasted."
      }
    ],
    "ground_truth_findings": [],
    "label": {
      "alignment_level": "A3",
      "fraud_risk_level": "MODERATE",
      "coherence_status": "MATERIALLY_INCOHERENT",
      "case_coherence_status": "INCOHERENT",
      "expected_outcome": "MANUAL_REVIEW",
      "difficulty": "INTERMEDIATE",
      "conditions": [
        "Verify large deposits",
        "Obtain written VOE"
      ],
      "reason": "flagged for elevated DTI"
    },
    "meta": {
      "seed": "seed-a0"
    }
  },
  {
    "id": "case-002",
    "applicant": {
      "name": "Linda Garcia",
      "age": 49,
      "ssn_last4": "4084",
      "zip_code": "805076",
      "region": "MEDIUM_COST"
    },
    "application": {
      "loan_type": "MORTGAGE",
      "loan_amount": 630000,
      "purpose": "REFINANCE",
      "submitted": "2026-07-31"
    },
    "application_metadata": {
      "submitted": "2026-07-30T20:03:00.000Z",
      "hour_of_day": 16,
      "day_of_week": 1,
      "is_business_hours": 1,
      "device_fingerprint": "bf158c0cc58d39a2637f89231bc59761",
      "ip_address": "62.2.134.48",
      "ip_risk_score": 0.091,
      "is_vpn": 0,
      "is_tor": 0,
      "isp": "Google Fiber",
      "typing_speed_wpm": 21,
      "fields_copy_pasted": 2,
      "session_duration_seconds": 676,
      "used_autofill": 0,
      "documents": [
        {
          "source": "W2_DOCUMENT",
          "created": "2026-03-14",
          "modified": "2026-03-14",
          "pdf_generator": "Smallpdf",
          "days_before_submission": 139
        },
        {
          "source": "BANK_STATEMENT",
          "created": "2026-07-14",
          "modified": "2026-07-14",
          "pdf_generator": "DocuSign",
          "days_before_submission": 17
        },
        {
          "source": "CREDIT_BUREAU",
          "created": "2026-03-11",
          "modified": "2026-03-11",
          "pdf_generator": "DocuSign",
          "days_before_submission": 142
        },
        {
          "source": "EMPLOYER_VERIFICATION",
          "created": "2026-03-02",
          "modified": "2026-03-02",
          "pdf_generator": "Smallpdf",
          "days_before_submission": 151
        }
      ]
    },
    "truth": {
      "entityId": "gen-1",
      "demographics": {
        "age": 49,
        "ssn_last4": "4084",
        "zip_code": "805076",
        "region": "MEDIUM_COST"
      },
      "events": [
        {
          "t": "2023-08-01",
          "type": "EMPLOYMENT_START",
          "entity": "Technology Corp",
          "salary": 180000
        },
        {
          "t": "2023-08-01",
          "type": "LIABILITY_OPENED",
          "type_detail": "STUDENT_LOAN",
          "payment": 508
        },
        {
          "t": "2021-06-01",
          "type": "ADDRESS_CHANGE",
          "type_detail": "RENTED",
          "address": "7893 Elm Blvd",
          "monthly_payment": 1302
        }
      ],
      "current_state": {
        "employment_status": "ACTIVE",
        "employer": "Technology Corp",
        "industry": "Technology",
        "persona": "IMMIGRANT_PROFESSIONAL",
        "tenure_stability": "recent",
        "salary": 180000,
        "tenure_months": 5,
        "checking_balance": 14213,
        "monthly_obligations": 508,
        "dti": 0.030144536382330885,
        "credit_score": 680,
        "down_payment": 175630,
        "regime": "SUBPRIME",
        "region": "MEDIUM_COST",
        "zip_code": "805076",
        "cost_of_living_index": 1.05,
        "housing_history": [
          {
            "t": "2021-06-01",
            "type": "ADDRESS_CHANGE",
            "type_detail": "RENTED",
            "address": "7893 Elm Blvd",
            "monthly_payment": 1302
          }
        ],
        "income_stream": {
          "gross_annual_salary": 180000,
          "pay_frequency": "MONTHLY",
          "checks_per_year": 12,
          "gross_per_check": 15000,
          "pretax_deduction_rate": 0.129,
          "net_per_check": 13058,
          "annual_w2_wages": 156699,
          "monthly_net_deposit": 13058
        },
        "expense_obligations": {
          "rent": 1302,
          "utilities": 199,
          "liabilities": 508,
          "discretionary": 1834,
          "total_monthly": 3843
        },
        "monthly_ledger": [
          {
            "month": "2026-05",
            "salary_deposits": 13307,
            "rent_paid": 1302,
            "utilities_paid": 199,
            "liability_payments": 508,
            "discretionary_spent": 2079,
            "total_outflows": 4088,
            "starting_checking_balance": -13332,
            "ending_checking_balance": -4113,
            "events": [
              {
                "type": "OVERDRAFT",
                "fee": 35
              }
            ]
          },
          {
            "month": "2026-07",
            "salary_deposits": 13219,
            "rent_paid": 1302,
            "utilities_paid": 199,
            "liability_payments": 508,
            "discretionary_spent": 1673,
            "total_outflows": 3682,
            "starting_checking_balance": -4113,
            "ending_checking_balance": 5424,
            "events": [
              {
                "type": "OVERDRAFT",
                "fee": 35
              }
            ]
          },
          {
            "month": "2026-07",
            "salary_deposits": 12340,
            "rent_paid": 1302,
            "utilities_paid": 199,
            "liability_payments": 508,
            "discretionary_spent": 1542,
            "total_outflows": 3551,
            "starting_checking_balance": 5424,
            "ending_checking_balance": 14213,
            "events": []
          }
        ],
        "overdraft_count": 2,
        "annual_w2_wages": 156699,
        "monthly_mortgage_payment": 4821,
        "loan_amount": 630000,
        "backend_dti": 0.3552666666666667
      }
    },
    "presentation": {
      "entityId": "gen-1",
      "demographics": {
        "age": 49,
        "ssn_last4": "4084",
        "zip_code": "805076",
        "region": "MEDIUM_COST"
      },
      "events": [
        {
          "t": "2023-08-01",
          "type": "EMPLOYMENT_START",
          "entity": "Technology Corp",
          "salary": 180000
        },
        {
          "t": "2023-08-01",
          "type": "LIABILITY_OPENED",
          "type_detail": "STUDENT_LOAN",
          "payment": 508
        },
        {
          "t": "2021-06-01",
          "type": "ADDRESS_CHANGE",
          "type_detail": "RENTED",
          "address": "7893 Elm Blvd",
          "monthly_payment": 1302
        }
      ],
      "current_state": {
        "employment_status": "ACTIVE",
        "employer": "Technology Corp",
        "industry": "Technology",
        "persona": "IMMIGRANT_PROFESSIONAL",
        "tenure_stability": "recent",
        "salary": 180000,
        "tenure_months": 5,
        "checking_balance": 14213,
        "monthly_obligations": 508,
        "dti": 0.030144536382330885,
        "credit_score": 680,
        "down_payment": 175630,
        "regime": "SUBPRIME",
        "region": "MEDIUM_COST",
        "zip_code": "805076",
        "cost_of_living_index": 1.05,
        "housing_history": [
          {
            "t": "2021-06-01",
            "type": "ADDRESS_CHANGE",
            "type_detail": "RENTED",
            "address": "7893 Elm Blvd",
            "monthly_payment": 1302
          }
        ],
        "income_stream": {
          "gross_annual_salary": 180000,
          "pay_frequency": "MONTHLY",
          "checks_per_year": 12,
          "gross_per_check": 15000,
          "pretax_deduction_rate": 0.129,
          "net_per_check": 13058,
          "annual_w2_wages": 156699,
          "monthly_net_deposit": 13058
        },
        "expense_obligations": {
          "rent": 1302,
          "utilities": 199,
          "liabilities": 508,
          "discretionary": 1834,
          "total_monthly": 3843
        },
        "monthly_ledger": [
          {
            "month": "2026-05",
            "salary_deposits": 13307,
            "rent_paid": 1302,
            "utilities_paid": 199,
            "liability_payments": 508,
            "discretionary_spent": 2079,
            "total_outflows": 4088,
            "starting_checking_balance": -13332,
            "ending_checking_balance": -4113,
            "events": [
              {
                "type": "OVERDRAFT",
                "fee": 35
              }
            ]
          },
          {
            "month": "2026-07",
            "salary_deposits": 13219,
            "rent_paid": 1302,
            "utilities_paid": 199,
            "liability_payments": 508,
            "discretionary_spent": 1673,
            "total_outflows": 3682,
            "starting_checking_balance": -4113,
            "ending_checking_balance": 5424,
            "events": [
              {
                "type": "OVERDRAFT",
                "fee": 35
              }
            ]
          },
          {
            "month": "2026-07",
            "salary_deposits": 12340,
            "rent_paid": 1302,
            "utilities_paid": 199,
            "liability_payments": 508,
            "discretionary_spent": 1542,
            "total_outflows": 3551,
            "starting_checking_balance": 5424,
            "ending_checking_balance": 14213,
            "events": []
          }
        ],
        "overdraft_count": 2,
        "annual_w2_wages": 156699,
        "monthly_mortgage_payment": 4821,
        "loan_amount": 630000,
        "backend_dti": 0.3552666666666667
      }
    },
    "evidence": [
      {
        "source": "W2_DOCUMENT",
        "date": "2026-07-31",
        "fields": {
          "w2_wages": 158498,
          "employer": "Technology Corp",
          "tax_year": 2024
        },
        "fidelity": 0.945138470917789
      },
      {
        "source": "EMPLOYER_VERIFICATION",
        "date": "2026-07-31",
        "fields": {
          "employer": "Technology Corp",
          "salary": 180000,
          "net_per_check": 13058,
          "pay_frequency": "MONTHLY",
          "status": "ACTIVE",
          "hire_date": "2023-08-01",
          "tenure_stability": "recent"
        },
        "fidelity": 0.9460181445091672
      },
      {
        "source": "BANK_STATEMENT",
        "date": "2026-07-31",
        "fields": {
          "checking_balance": 14349,
          "recurring_debits": [
            {
              "payee": "Student Loan Servicer",
              "amount": 508
            },
            {
              "payee": "Property Management",
              "amount": 1302
            },
            {
              "payee": "Utility Providers",
              "amount": 199
            }
          ],
          "monthly_payroll_deposit": 12955,
          "rent_payments": [
            {
              "month": "2026-05",
              "amount": 1302
            },
            {
              "month": "2026-07",
              "amount": 1302
            },
            {
              "month": "2026-07",
              "amount": 1302
            }
          ],
          "overdraft_count": 2,
          "recent_large_deposits": [],
          "months_of_statements": 3
        },
        "fidelity": 0.999
      },
      {
        "source": "CREDIT_BUREAU",
        "date": "2026-07-31",
        "fields": {
          "credit_score": 684,
          "open_accounts": 4,
          "liabilities": [
            {
              "type": "STUDENT_LOAN",
              "payment": 508
            }
          ],
          "persona": "IMMIGRANT_PROFESSIONAL"
        },
        "fidelity": 0.9356542101142222
      },
      {
        "source": "RENT_VERIFICATION",
        "date": "2026-07-31",
        "fields": {
          "current_address": "7893 Elm Blvd",
          "monthly_rent": 1302,
          "lease_start": "2021-06-01",
          "payment_history": "CURRENT"
        },
        "fidelity": 0.9755036390070627
      },
      {
        "source": "GEOGRAPHIC_VERIFICATION",
        "date": "2026-07-31",
        "fields": {
          "zip_code": "805076",
          "region": "MEDIUM_COST",
          "cost_of_living_index": 1.05
        },
        "fidelity": 0.9338162803574029
      }
    ],
    "alignment_findings": [
      {
        "dimension": "identity",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Applicant name, age, and SSN are consistent across application and evidence."
      },
      {
        "dimension": "employment",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Employer Technology Corp verified."
      },
      {
        "dimension": "income",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Self-reported $180,000 matches verified income $180,000."
      },
      {
        "dimension": "assets",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Self-reported checking $14,213 matches bank statement $14,349."
      },
      {
        "dimension": "liabilities",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Application liabilities match credit bureau (1 accounts, $508/mo)."
      },
      {
        "dimension": "address",
        "level": "A0",
        "status": "NOT_VERIFIED",
        "details": "Address data not collected in current model; assumed consistent."
      },
      {
        "dimension": "timeline",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Employment and liability timeline is consistent."
      },
      {
        "dimension": "cash_flow",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Cash flow supports disclosed obligations and proposed mortgage with comfortable residual income."
      },
      {
        "dimension": "affordability",
        "level": "A0",
        "status": "STRONG",
        "details": "Back-end DTI 35.5% (PITI $4,821) is within policy guidelines."
      },
      {
        "dimension": "document_metadata",
        "level": "A0",
        "status": "DOCUMENT_AGES_NORMAL",
        "details": "Supporting documents have plausible ages."
      },
      {
        "dimension": "network",
        "level": "A0",
        "status": "IP_TRUSTED",
        "details": "IP origin is low-risk and not anonymized."
      },
      {
        "dimension": "behavioral",
        "level": "A0",
        "status": "BUSINESS_HOURS",
        "details": "Submitted during normal business hours."
      },
      {
        "dimension": "behavioral",
        "level": "A1",
        "status": "SOME_COPY_PASTE",
        "details": "2 fields were copy-pasted."
      }
    ],
    "ground_truth_findings": [],
    "label": {
      "alignment_level": "A1",
      "fraud_risk_level": "NONE",
      "coherence_status": "MOSTLY_COHERENT",
      "case_coherence_status": "COHERENT_WITH_EXPLAINABLE_VARIANCES",
      "expected_outcome": "DECLINE",
      "difficulty": "INTERMEDIATE",
      "conditions": [
        "Reduce DTI or increase income"
      ],
      "reason": "rejected for insufficient employment history"
    },
    "meta": {
      "seed": "seed-a1"
    }
  },
  {
    "id": "case-003",
    "applicant": {
      "name": "Robert Garcia",
      "age": 37,
      "ssn_last4": "9773",
      "zip_code": "283012",
      "region": "MEDIUM_COST"
    },
    "application": {
      "loan_type": "MORTGAGE",
      "loan_amount": 239802,
      "purpose": "REFINANCE",
      "submitted": "2026-07-31"
    },
    "application_metadata": {
      "submitted": "2026-07-30T19:22:00.000Z",
      "hour_of_day": 15,
      "day_of_week": 3,
      "is_business_hours": 1,
      "device_fingerprint": "d56e86772442ccd6d3d114dca973346a",
      "ip_address": "20.58.1.68",
      "ip_risk_score": 0.81,
      "is_vpn": 1,
      "is_tor": 0,
      "isp": "AT&T",
      "typing_speed_wpm": 93,
      "fields_copy_pasted": 2,
      "session_duration_seconds": 148,
      "used_autofill": 1,
      "documents": [
        {
          "source": "W2_DOCUMENT",
          "created": "2026-07-30",
          "modified": "2026-07-30",
          "pdf_generator": "DocuSign",
          "days_before_submission": 1
        },
        {
          "source": "BANK_STATEMENT",
          "created": "2026-07-28",
          "modified": "2026-07-28",
          "pdf_generator": "Chrome PDF Generator",
          "days_before_submission": 3
        },
        {
          "source": "CREDIT_BUREAU",
          "created": "2026-07-31",
          "modified": "2026-07-31",
          "pdf_generator": "Smallpdf",
          "days_before_submission": 0
        },
        {
          "source": "EMPLOYER_VERIFICATION",
          "created": "2026-07-30",
          "modified": "2026-07-30",
          "pdf_generator": "DocuSign",
          "days_before_submission": 1
        }
      ]
    },
    "truth": {
      "entityId": "gen-2",
      "demographics": {
        "age": 37,
        "ssn_last4": "9773",
        "zip_code": "283012",
        "region": "MEDIUM_COST"
      },
      "events": [
        {
          "t": "2020-07-01",
          "type": "EMPLOYMENT_START",
          "entity": "Retail Corp",
          "salary": 68515
        },
        {
          "t": "2021-11-01",
          "type": "LIABILITY_OPENED",
          "type_detail": "AUTO_LOAN",
          "payment": 466
        },
        {
          "t": "2017-09-01",
          "type": "ADDRESS_CHANGE",
          "type_detail": "RENTED",
          "address": "8730 Elm Ave",
          "monthly_payment": 1506
        },
        {
          "t": "2021-05-01",
          "type": "ADDRESS_CHANGE",
          "type_detail": "RENTED",
          "address": "7348 Willow Blvd",
          "monthly_payment": 1714
        }
      ],
      "current_state": {
        "employment_status": "ACTIVE",
        "employer": "Retail Corp",
        "industry": "Retail",
        "persona": "RETAIL_MANAGER",
        "tenure_stability": "stable",
        "salary": 68515,
        "tenure_months": 42,
        "checking_balance": 10282,
        "monthly_obligations": 466,
        "dti": 0.010867581283211915,
        "credit_score": 678,
        "down_payment": 3401,
        "regime": "PRIME",
        "region": "MEDIUM_COST",
        "zip_code": "283012",
        "cost_of_living_index": 1.05,
        "housing_history": [
          {
            "t": "2017-09-01",
            "type": "ADDRESS_CHANGE",
            "type_detail": "RENTED",
            "address": "8730 Elm Ave",
            "monthly_payment": 1506
          },
          {
            "t": "2021-05-01",
            "type": "ADDRESS_CHANGE",
            "type_detail": "RENTED",
            "address": "7348 Willow Blvd",
            "monthly_payment": 1714
          }
        ],
        "income_stream": {
          "gross_annual_salary": 68515,
          "pay_frequency": "BIWEEKLY",
          "checks_per_year": 26,
          "gross_per_check": 2635,
          "pretax_deduction_rate": 0.192,
          "net_per_check": 2131,
          "annual_w2_wages": 55394,
          "monthly_net_deposit": 4617
        },
        "expense_obligations": {
          "rent": 1714,
          "utilities": 193,
          "liabilities": 466,
          "discretionary": 716,
          "total_monthly": 3089
        },
        "monthly_ledger": [
          {
            "month": "2026-05",
            "salary_deposits": 4433,
            "rent_paid": 1714,
            "utilities_paid": 193,
            "liability_payments": 466,
            "discretionary_spent": 768,
            "total_outflows": 3141,
            "starting_checking_balance": 5798,
            "ending_checking_balance": 7090,
            "events": []
          },
          {
            "month": "2026-07",
            "salary_deposits": 4690,
            "rent_paid": 1714,
            "utilities_paid": 193,
            "liability_payments": 466,
            "discretionary_spent": 724,
            "total_outflows": 3097,
            "starting_checking_balance": 7090,
            "ending_checking_balance": 8683,
            "events": []
          },
          {
            "month": "2026-07",
            "salary_deposits": 4663,
            "rent_paid": 1714,
            "utilities_paid": 193,
            "liability_payments": 466,
            "discretionary_spent": 691,
            "total_outflows": 3064,
            "starting_checking_balance": 8683,
            "ending_checking_balance": 10282,
            "events": []
          }
        ],
        "overdraft_count": 0,
        "annual_w2_wages": 55394,
        "monthly_mortgage_payment": 1835,
        "loan_amount": 239802,
        "backend_dti": 0.4030066408815588
      }
    },
    "presentation": {
      "entityId": "gen-2",
      "demographics": {
        "age": 37,
        "ssn_last4": "9773",
        "zip_code": "283012",
        "region": "MEDIUM_COST"
      },
      "events": [
        {
          "t": "2020-07-01",
          "type": "EMPLOYMENT_START",
          "entity": "Retail Corp",
          "salary": 68515
        },
        {
          "t": "2017-09-01",
          "type": "ADDRESS_CHANGE",
          "type_detail": "RENTED",
          "address": "8730 Elm Ave",
          "monthly_payment": 1506
        },
        {
          "t": "2021-05-01",
          "type": "ADDRESS_CHANGE",
          "type_detail": "RENTED",
          "address": "7348 Willow Blvd",
          "monthly_payment": 1714
        }
      ],
      "current_state": {
        "employment_status": "ACTIVE",
        "employer": "Retail Corp",
        "industry": "Retail",
        "persona": "RETAIL_MANAGER",
        "tenure_stability": "stable",
        "salary": 68515,
        "tenure_months": 42,
        "checking_balance": 10282,
        "monthly_obligations": 0,
        "dti": 0.010867581283211915,
        "credit_score": 678,
        "down_payment": 3401,
        "regime": "PRIME",
        "region": "MEDIUM_COST",
        "zip_code": "283012",
        "cost_of_living_index": 1.05,
        "housing_history": [
          {
            "t": "2017-09-01",
            "type": "ADDRESS_CHANGE",
            "type_detail": "RENTED",
            "address": "8730 Elm Ave",
            "monthly_payment": 1506
          },
          {
            "t": "2021-05-01",
            "type": "ADDRESS_CHANGE",
            "type_detail": "RENTED",
            "address": "7348 Willow Blvd",
            "monthly_payment": 1714
          }
        ],
        "income_stream": {
          "gross_annual_salary": 68515,
          "pay_frequency": "BIWEEKLY",
          "checks_per_year": 26,
          "gross_per_check": 2635,
          "pretax_deduction_rate": 0.192,
          "net_per_check": 2131,
          "annual_w2_wages": 55394,
          "monthly_net_deposit": 4617
        },
        "expense_obligations": {
          "rent": 1714,
          "utilities": 193,
          "liabilities": 466,
          "discretionary": 716,
          "total_monthly": 3089
        },
        "monthly_ledger": [
          {
            "month": "2026-05",
            "salary_deposits": 4433,
            "rent_paid": 1714,
            "utilities_paid": 193,
            "liability_payments": 466,
            "discretionary_spent": 768,
            "total_outflows": 3141,
            "starting_checking_balance": 5798,
            "ending_checking_balance": 7090,
            "events": []
          },
          {
            "month": "2026-07",
            "salary_deposits": 4690,
            "rent_paid": 1714,
            "utilities_paid": 193,
            "liability_payments": 466,
            "discretionary_spent": 724,
            "total_outflows": 3097,
            "starting_checking_balance": 7090,
            "ending_checking_balance": 8683,
            "events": []
          },
          {
            "month": "2026-07",
            "salary_deposits": 4663,
            "rent_paid": 1714,
            "utilities_paid": 193,
            "liability_payments": 466,
            "discretionary_spent": 691,
            "total_outflows": 3064,
            "starting_checking_balance": 8683,
            "ending_checking_balance": 10282,
            "events": []
          }
        ],
        "overdraft_count": 0,
        "annual_w2_wages": 55394,
        "monthly_mortgage_payment": 1835,
        "loan_amount": 239802,
        "backend_dti": 0.32138947675691454
      }
    },
    "evidence": [
      {
        "source": "W2_DOCUMENT",
        "date": "2026-07-31",
        "fields": {
          "w2_wages": 56846,
          "employer": "Retail Corp",
          "tax_year": 2024
        },
        "fidelity": 0.9932156838059718
      },
      {
        "source": "EMPLOYER_VERIFICATION",
        "date": "2026-07-31",
        "fields": {
          "employer": "Retail Corp",
          "salary": 68515,
          "net_per_check": 2131,
          "pay_frequency": "BIWEEKLY",
          "status": "ACTIVE",
          "hire_date": "2020-07-01",
          "tenure_stability": "stable"
        },
        "fidelity": 0.999
      },
      {
        "source": "BANK_STATEMENT",
        "date": "2026-07-31",
        "fields": {
          "checking_balance": 10095,
          "recurring_debits": [
            {
              "payee": "Auto Finance",
              "amount": 466
            },
            {
              "payee": "Property Management",
              "amount": 1714
            },
            {
              "payee": "Utility Providers",
              "amount": 193
            }
          ],
          "monthly_payroll_deposit": 4595,
          "rent_payments": [
            {
              "month": "2026-05",
              "amount": 1714
            },
            {
              "month": "2026-07",
              "amount": 1714
            },
            {
              "month": "2026-07",
              "amount": 1714
            }
          ],
          "overdraft_count": 0,
          "recent_large_deposits": [],
          "months_of_statements": 3
        },
        "fidelity": 0.962520312029984
      },
      {
        "source": "CREDIT_BUREAU",
        "date": "2026-07-31",
        "fields": {
          "credit_score": 677,
          "open_accounts": 2,
          "liabilities": [
            {
              "type": "AUTO_LOAN",
              "payment": 466
            }
          ],
          "persona": "RETAIL_MANAGER"
        },
        "fidelity": 0.952456423484248
      },
      {
        "source": "RENT_VERIFICATION",
        "date": "2026-07-31",
        "fields": {
          "current_address": "7348 Willow Blvd",
          "monthly_rent": 1714,
          "lease_start": "2017-09-01",
          "payment_history": "CURRENT"
        },
        "fidelity": 0.9828838769261121
      },
      {
        "source": "GEOGRAPHIC_VERIFICATION",
        "date": "2026-07-31",
        "fields": {
          "zip_code": "283012",
          "region": "MEDIUM_COST",
          "cost_of_living_index": 1.05
        },
        "fidelity": 0.9638471787531353
      }
    ],
    "alignment_findings": [
      {
        "dimension": "identity",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Applicant name, age, and SSN are consistent across application and evidence."
      },
      {
        "dimension": "employment",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Employer Retail Corp verified."
      },
      {
        "dimension": "income",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Self-reported $68,515 matches verified income $68,515."
      },
      {
        "dimension": "assets",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Self-reported checking $10,282 matches bank statement $10,095."
      },
      {
        "dimension": "liabilities",
        "level": "A3",
        "status": "MATERIAL_MISMATCH",
        "details": "Application discloses 0 liability/liabilities ($0/mo); credit bureau shows 1 ($466/mo). Hidden debt: $466/mo."
      },
      {
        "dimension": "address",
        "level": "A0",
        "status": "NOT_VERIFIED",
        "details": "Address data not collected in current model; assumed consistent."
      },
      {
        "dimension": "timeline",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Employment and liability timeline is consistent."
      },
      {
        "dimension": "cash_flow",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Cash flow supports disclosed obligations and proposed mortgage with comfortable residual income."
      },
      {
        "dimension": "affordability",
        "level": "A0",
        "status": "STRONG",
        "details": "Back-end DTI 32.1% (PITI $1,835) is within policy guidelines."
      },
      {
        "dimension": "document_metadata",
        "level": "A3",
        "status": "SUSPICIOUS_DOCUMENT_AGES",
        "details": "3 of 4 supporting documents were created within 2 days of submission."
      },
      {
        "dimension": "network",
        "level": "A4",
        "status": "HIGH_RISK_IP",
        "details": "IP risk score 0.81; origin is high-risk or anonymized."
      },
      {
        "dimension": "behavioral",
        "level": "A0",
        "status": "BUSINESS_HOURS",
        "details": "Submitted during normal business hours."
      },
      {
        "dimension": "behavioral",
        "level": "A1",
        "status": "SOME_COPY_PASTE",
        "details": "2 fields were copy-pasted."
      }
    ],
    "ground_truth_findings": [
      {
        "type": "LIABILITY_CONCEALMENT",
        "target_layer": "CLAIMED_TRUTH",
        "claimed_value": 0,
        "true_value": 466,
        "classification": "A4",
        "evidence_citations": [
          {
            "source": "BANK_STATEMENT",
            "field": "recurring_debits",
            "value": [
              {
                "payee": "Auto Finance",
                "amount": 466
              },
              {
                "payee": "Property Management",
                "amount": 1714
              },
              {
                "payee": "Utility Providers",
                "amount": 193
              }
            ]
          },
          {
            "source": "CREDIT_BUREAU",
            "field": "liabilities",
            "value": [
              {
                "type": "AUTO_LOAN",
                "payment": 466
              }
            ]
          }
        ],
        "details": "Application discloses 0 liabilities ($0/mo); truth has 1 ($466/mo)."
      }
    ],
    "label": {
      "alignment_level": "A4",
      "fraud_risk_level": "HIGH",
      "coherence_status": "INTENTIONALLY_ADVERSARIAL",
      "case_coherence_status": "FRAUDULENT",
      "expected_outcome": "DECLINE",
      "difficulty": "ADVANCED",
      "conditions": [
        "Verify applicant identity and device provenance",
        "Request original source documents"
      ],
      "reason": "rejected for high-risk network origin"
    },
    "meta": {
      "seed": "seed-a3"
    }
  },
  {
    "id": "case-004",
    "applicant": {
      "name": "John Johnson",
      "age": 28,
      "ssn_last4": "7950",
      "zip_code": "121762",
      "region": "MEDIUM_COST"
    },
    "application": {
      "loan_type": "MORTGAGE",
      "loan_amount": 556454,
      "purpose": "PURCHASE",
      "submitted": "2026-07-31"
    },
    "application_metadata": {
      "submitted": "2026-07-30T14:35:00.000Z",
      "hour_of_day": 10,
      "day_of_week": 5,
      "is_business_hours": 1,
      "device_fingerprint": "9625f3bced810b61cf0b800ac6cb5689",
      "ip_address": "93.130.178.254",
      "ip_risk_score": 0.628,
      "is_vpn": 0,
      "is_tor": 0,
      "isp": "Unknown ISP",
      "typing_speed_wpm": 40,
      "fields_copy_pasted": 7,
      "session_duration_seconds": 172,
      "used_autofill": 0,
      "documents": [
        {
          "source": "W2_DOCUMENT",
          "created": "2026-07-31",
          "modified": "2026-07-31",
          "pdf_generator": "Microsoft Print to PDF",
          "days_before_submission": 0
        },
        {
          "source": "BANK_STATEMENT",
          "created": "2026-07-29",
          "modified": "2026-07-29",
          "pdf_generator": "Smallpdf",
          "days_before_submission": 2
        },
        {
          "source": "CREDIT_BUREAU",
          "created": "2026-07-31",
          "modified": "2026-07-31",
          "pdf_generator": "Adobe PDF Library",
          "days_before_submission": 0
        },
        {
          "source": "EMPLOYER_VERIFICATION",
          "created": "2026-07-28",
          "modified": "2026-07-28",
          "pdf_generator": "DocuSign",
          "days_before_submission": 3
        }
      ]
    },
    "truth": {
      "entityId": "gen-3",
      "demographics": {
        "age": 28,
        "ssn_last4": "7950",
        "zip_code": "121762",
        "region": "MEDIUM_COST"
      },
      "events": [
        {
          "t": "2021-01-01",
          "type": "EMPLOYMENT_START",
          "entity": "Healthcare Corp",
          "salary": 101060
        },
        {
          "t": "2022-02-01",
          "type": "SALARY_INCREASE",
          "salary": 102237
        },
        {
          "t": "2022-08-01",
          "type": "LIABILITY_OPENED",
          "type_detail": "AUTO_LOAN",
          "payment": 653
        },
        {
          "t": "2019-02-01",
          "type": "ADDRESS_CHANGE",
          "type_detail": "RENTED",
          "address": "1466 Pine St",
          "monthly_payment": 1973
        }
      ],
      "current_state": {
        "employment_status": "ACTIVE",
        "employer": "Healthcare Corp",
        "industry": "Healthcare",
        "persona": "NURSE",
        "tenure_stability": "stable",
        "salary": 102237,
        "tenure_months": 36,
        "checking_balance": 6778,
        "monthly_obligations": 891,
        "dti": 0.10579623295338837,
        "credit_score": 661,
        "down_payment": 38407,
        "regime": "SUBPRIME",
        "region": "MEDIUM_COST",
        "zip_code": "121762",
        "cost_of_living_index": 1.05,
        "housing_history": [
          {
            "t": "2019-02-01",
            "type": "ADDRESS_CHANGE",
            "type_detail": "RENTED",
            "address": "1466 Pine St",
            "monthly_payment": 1973
          }
        ],
        "income_stream": {
          "gross_annual_salary": 102237,
          "pay_frequency": "MONTHLY",
          "checks_per_year": 12,
          "gross_per_check": 8520,
          "pretax_deduction_rate": 0.281,
          "net_per_check": 6129,
          "annual_w2_wages": 73546,
          "monthly_net_deposit": 6129
        },
        "expense_obligations": {
          "rent": 1973,
          "utilities": 207,
          "liabilities": 891,
          "discretionary": 1170,
          "total_monthly": 4241
        },
        "monthly_ledger": [
          {
            "month": "2026-05",
            "salary_deposits": 6019,
            "rent_paid": 1973,
            "utilities_paid": 207,
            "liability_payments": 891,
            "discretionary_spent": 1104,
            "total_outflows": 4175,
            "starting_checking_balance": 1280,
            "ending_checking_balance": 3124,
            "events": []
          },
          {
            "month": "2026-07",
            "salary_deposits": 6169,
            "rent_paid": 1973,
            "utilities_paid": 207,
            "liability_payments": 891,
            "discretionary_spent": 1135,
            "total_outflows": 4206,
            "starting_checking_balance": 3124,
            "ending_checking_balance": 5087,
            "events": []
          },
          {
            "month": "2026-07",
            "salary_deposits": 6092,
            "rent_paid": 1973,
            "utilities_paid": 207,
            "liability_payments": 891,
            "discretionary_spent": 1330,
            "total_outflows": 4401,
            "starting_checking_balance": 5087,
            "ending_checking_balance": 6778,
            "events": []
          }
        ],
        "overdraft_count": 0,
        "annual_w2_wages": 73546,
        "monthly_mortgage_payment": 4259,
        "loan_amount": 556454,
        "backend_dti": 0.6044778309222688
      }
    },
    "presentation": {
      "entityId": "gen-3",
      "demographics": {
        "age": 28,
        "ssn_last4": "7950",
        "zip_code": "121762",
        "region": "MEDIUM_COST"
      },
      "events": [
        {
          "t": "2021-01-01",
          "type": "EMPLOYMENT_START",
          "entity": "Global Finance",
          "salary": 158987
        },
        {
          "t": "2021-01-01",
          "type": "EMPLOYMENT_START",
          "entity": "Healthcare Corp",
          "salary": 101060
        },
        {
          "t": "2022-02-01",
          "type": "SALARY_INCREASE",
          "salary": 102237
        },
        {
          "t": "2022-08-01",
          "type": "LIABILITY_OPENED",
          "type_detail": "AUTO_LOAN",
          "payment": 653
        },
        {
          "t": "2019-02-01",
          "type": "ADDRESS_CHANGE",
          "type_detail": "RENTED",
          "address": "1466 Pine St",
          "monthly_payment": 1973
        }
      ],
      "current_state": {
        "employment_status": "ACTIVE",
        "employer": "Global Finance",
        "industry": "Healthcare",
        "persona": "NURSE",
        "tenure_stability": "stable",
        "salary": 158987,
        "tenure_months": 36,
        "checking_balance": 43177,
        "monthly_obligations": 891,
        "dti": 0.10579623295338837,
        "credit_score": 661,
        "down_payment": 38407,
        "regime": "SUBPRIME",
        "region": "MEDIUM_COST",
        "zip_code": "121762",
        "cost_of_living_index": 1.05,
        "housing_history": [
          {
            "t": "2019-02-01",
            "type": "ADDRESS_CHANGE",
            "type_detail": "RENTED",
            "address": "1466 Pine St",
            "monthly_payment": 1973
          }
        ],
        "income_stream": {
          "gross_annual_salary": 102237,
          "pay_frequency": "MONTHLY",
          "checks_per_year": 12,
          "gross_per_check": 8520,
          "pretax_deduction_rate": 0.281,
          "net_per_check": 6129,
          "annual_w2_wages": 73546,
          "monthly_net_deposit": 6129
        },
        "expense_obligations": {
          "rent": 1973,
          "utilities": 207,
          "liabilities": 891,
          "discretionary": 1170,
          "total_monthly": 4241
        },
        "monthly_ledger": [
          {
            "month": "2026-05",
            "salary_deposits": 6019,
            "rent_paid": 1973,
            "utilities_paid": 207,
            "liability_payments": 891,
            "discretionary_spent": 1104,
            "total_outflows": 4175,
            "starting_checking_balance": 1280,
            "ending_checking_balance": 3124,
            "events": []
          },
          {
            "month": "2026-07",
            "salary_deposits": 6169,
            "rent_paid": 1973,
            "utilities_paid": 207,
            "liability_payments": 891,
            "discretionary_spent": 1135,
            "total_outflows": 4206,
            "starting_checking_balance": 3124,
            "ending_checking_balance": 5087,
            "events": []
          },
          {
            "month": "2026-07",
            "salary_deposits": 6092,
            "rent_paid": 1973,
            "utilities_paid": 207,
            "liability_payments": 891,
            "discretionary_spent": 1330,
            "total_outflows": 4401,
            "starting_checking_balance": 5087,
            "ending_checking_balance": 6778,
            "events": []
          }
        ],
        "overdraft_count": 0,
        "annual_w2_wages": 73546,
        "monthly_mortgage_payment": 4259,
        "loan_amount": 556454,
        "backend_dti": 0.3887110266877166
      }
    },
    "evidence": [
      {
        "source": "W2_DOCUMENT",
        "date": "2026-07-31",
        "fields": {
          "w2_wages": 74881,
          "employer": "Healthcare Corp",
          "tax_year": 2024
        },
        "fidelity": 0.9673240627257563
      },
      {
        "source": "EMPLOYER_VERIFICATION",
        "date": "2026-07-31",
        "fields": {
          "employer": "Healthcare Corp",
          "salary": 102237,
          "net_per_check": 6129,
          "pay_frequency": "MONTHLY",
          "status": "ACTIVE",
          "hire_date": "2021-01-01",
          "tenure_stability": "stable"
        },
        "fidelity": 0.9702660524184065
      },
      {
        "source": "BANK_STATEMENT",
        "date": "2026-07-31",
        "fields": {
          "checking_balance": 6695,
          "recurring_debits": [
            {
              "payee": "Auto Finance",
              "amount": 653
            },
            {
              "payee": "Property Management",
              "amount": 1973
            },
            {
              "payee": "Utility Providers",
              "amount": 207
            }
          ],
          "monthly_payroll_deposit": 6093,
          "rent_payments": [
            {
              "month": "2026-05",
              "amount": 1973
            },
            {
              "month": "2026-07",
              "amount": 1973
            },
            {
              "month": "2026-07",
              "amount": 1973
            }
          ],
          "overdraft_count": 0,
          "recent_large_deposits": [],
          "months_of_statements": 3
        },
        "fidelity": 0.978543135167354
      },
      {
        "source": "CREDIT_BUREAU",
        "date": "2026-07-31",
        "fields": {
          "credit_score": 669,
          "open_accounts": 2,
          "liabilities": [
            {
              "type": "AUTO_LOAN",
              "payment": 653
            }
          ],
          "persona": "NURSE"
        },
        "fidelity": 0.9585738071353294
      },
      {
        "source": "RENT_VERIFICATION",
        "date": "2026-07-31",
        "fields": {
          "current_address": "1466 Pine St",
          "monthly_rent": 1973,
          "lease_start": "2019-02-01",
          "payment_history": "CURRENT"
        },
        "fidelity": 0.982272045067672
      },
      {
        "source": "GEOGRAPHIC_VERIFICATION",
        "date": "2026-07-31",
        "fields": {
          "zip_code": "121762",
          "region": "MEDIUM_COST",
          "cost_of_living_index": 1.05
        },
        "fidelity": 0.9597765238187386
      }
    ],
    "alignment_findings": [
      {
        "dimension": "identity",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Applicant name, age, and SSN are consistent across application and evidence."
      },
      {
        "dimension": "employment",
        "level": "A4",
        "status": "PROBABLE_MANIPULATION",
        "details": "Application claims Global Finance; employer verification shows Healthcare Corp."
      },
      {
        "dimension": "income",
        "level": "A4",
        "status": "PROBABLE_MANIPULATION",
        "details": "Self-reported $158,987 is $56,750 higher than verified $102,237 / W-2 $74,881."
      },
      {
        "dimension": "assets",
        "level": "A3",
        "status": "MATERIAL_MISMATCH",
        "details": "Self-reported checking $43,177 is $36,399 higher than bank $6,778."
      },
      {
        "dimension": "liabilities",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Application liabilities match credit bureau (1 accounts, $891/mo)."
      },
      {
        "dimension": "address",
        "level": "A0",
        "status": "NOT_VERIFIED",
        "details": "Address data not collected in current model; assumed consistent."
      },
      {
        "dimension": "timeline",
        "level": "A4",
        "status": "IMPOSSIBLE_SEQUENCE",
        "details": "Employment history claims Global Finance but verification shows Healthcare Corp."
      },
      {
        "dimension": "cash_flow",
        "level": "A0",
        "status": "ALIGNED",
        "details": "Cash flow supports disclosed obligations and proposed mortgage with comfortable residual income."
      },
      {
        "dimension": "affordability",
        "level": "A0",
        "status": "STRONG",
        "details": "Back-end DTI 38.9% (PITI $4,259) is within policy guidelines."
      },
      {
        "dimension": "document_metadata",
        "level": "A3",
        "status": "SUSPICIOUS_DOCUMENT_AGES",
        "details": "3 of 4 supporting documents were created within 2 days of submission."
      },
      {
        "dimension": "network",
        "level": "A2",
        "status": "ANONYMIZED_OR_VPN",
        "details": "Application originated from VPN or elevated-risk IP."
      },
      {
        "dimension": "behavioral",
        "level": "A0",
        "status": "BUSINESS_HOURS",
        "details": "Submitted during normal business hours."
      },
      {
        "dimension": "behavioral",
        "level": "A3",
        "status": "EXCESSIVE_COPY_PASTE",
        "details": "7 fields were copy-pasted; inconsistent with natural typing."
      }
    ],
    "ground_truth_findings": [
      {
        "type": "INCOME_MISREPRESENTATION",
        "target_layer": "CLAIMED_TRUTH",
        "claimed_value": 158987,
        "true_value": 102237,
        "classification": "A4",
        "evidence_citations": [
          {
            "source": "W2_DOCUMENT",
            "field": "w2_wages",
            "value": 74881
          },
          {
            "source": "EMPLOYER_VERIFICATION",
            "field": "salary",
            "value": 102237
          },
          {
            "source": "BANK_STATEMENT",
            "field": "monthly_payroll_deposit",
            "value": 6093
          }
        ],
        "details": "Application claims $158,987; verified income is $102,237."
      },
      {
        "type": "ASSET_MISREPRESENTATION",
        "target_layer": "CLAIMED_TRUTH",
        "claimed_value": 43177,
        "true_value": 6778,
        "classification": "A3",
        "evidence_citations": [
          {
            "source": "BANK_STATEMENT",
            "field": "checking_balance",
            "value": 6695
          }
        ],
        "details": "Application checking $43,177 vs bank statement $6,778."
      },
      {
        "type": "EMPLOYER_FABRICATION",
        "target_layer": "CLAIMED_TRUTH",
        "claimed_value": "Global Finance",
        "true_value": "Healthcare Corp",
        "classification": "A4",
        "evidence_citations": [
          {
            "source": "W2_DOCUMENT",
            "field": "employer",
            "value": "Healthcare Corp"
          },
          {
            "source": "EMPLOYER_VERIFICATION",
            "field": "employer",
            "value": "Healthcare Corp"
          }
        ],
        "details": "Application employer Global Finance does not match verified employer Healthcare Corp."
      }
    ],
    "label": {
      "alignment_level": "A4",
      "fraud_risk_level": "HIGH",
      "coherence_status": "INTENTIONALLY_ADVERSARIAL",
      "case_coherence_status": "FRAUDULENT",
      "expected_outcome": "DECLINE",
      "difficulty": "ADVANCED",
      "conditions": [
        "Verify applicant identity and device provenance",
        "Request original source documents"
      ],
      "reason": "rejected for suspicious document metadata"
    },
    "meta": {
      "seed": "seed-a4"
    }
  }
];


// ─── 2. DATA TABLE & VALIDATION ────────────────────────────
function exportStatistics(stats) {
  const report = { timestamp: new Date().toISOString(), sample_size: stats.age.values.length, statistics: stats };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `validation_report.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
function DataTableTab({ cases }) {
  const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'desc' });
  const [filterText, setFilterText] = useState("");
  const sortedCases = React.useMemo(() => {
    let sortableItems = [...cases];
    if (filterText) sortableItems = sortableItems.filter(c => c.applicant.name.toLowerCase().includes(filterText.toLowerCase()) || c.application.purpose.toLowerCase().includes(filterText.toLowerCase()));
    sortableItems.sort((a, b) => {
      let aValue, bValue; const key = sortConfig.key;
      if (key === 'dti') { aValue = a.truth.current_state?.dti || 0; bValue = b.truth.current_state?.dti || 0; }
      else if (key === 'salary') { aValue = a.truth.current_state?.salary || 0; bValue = b.truth.current_state?.salary || 0; }
      else if (key === 'credit_score') { aValue = a.truth.current_state?.credit_score || 0; bValue = b.truth.current_state?.credit_score || 0; }
      else if (key.includes('.')) { const [p, c] = key.split('.'); aValue = a[p][c]; bValue = b[p][c]; }
      else { aValue = a[key]; bValue = b[key]; }
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sortableItems;
  }, [cases, sortConfig, filterText]);
  const requestSort = (key) => { let direction = 'asc'; if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc'; setSortConfig({ key, direction }); };
  const exportToCSV = () => {
    const headers = ["Name", "Age", "Loan Amount", "Purpose", "Salary", "DTI", "Credit Score", "Checking", "Align", "Outcome", "Fraud Risk"];
    const rows = sortedCases.map(c => [c.applicant.name, c.applicant.age, c.application.loan_amount, c.application.purpose, c.truth.current_state?.salary || 0, ((c.truth.current_state?.dti || 0) * 100).toFixed(1) + "%", c.truth.current_state?.credit_score || 0, c.truth.current_state?.checking_balance || 0, c.label.alignment_level, c.label.expected_outcome, c.label.fraud_risk_level]);
    const csvContent = headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `financial_profiles.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
  };
  return (
    <div>
      <div style={styles.tableToolbar}>
        <input type="text" placeholder="Filter by name or purpose..." value={filterText} onChange={(e) => setFilterText(e.target.value)} style={styles.filterInput} />
        <button onClick={exportToCSV} style={styles.btnCSV}>Export CSV</button>
      </div>
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead><tr>
            <Th label="Name" sortKey="applicant.name" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Age" sortKey="applicant.age" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Loan Amount" sortKey="application.loan_amount" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Purpose" sortKey="application.purpose" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Salary" sortKey="salary" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="DTI" sortKey="dti" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Credit Score" sortKey="credit_score" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Checking" sortKey="truth.current_state.checking_balance" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Align" sortKey="label.alignment_level" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Outcome" sortKey="label.expected_outcome" sortConfig={sortConfig} onSort={requestSort} />
            <Th label="Fraud Risk" sortKey="label.fraud_risk_level" sortConfig={sortConfig} onSort={requestSort} />
          </tr></thead>
          <tbody>{sortedCases.map((c) => (<tr key={c.id} style={styles.tableRow}>
            <td style={styles.td}><strong>{c.applicant.name}</strong></td>
            <td style={styles.td}>{c.applicant.age}</td>
            <td style={styles.td}>${c.application.loan_amount.toLocaleString()}</td>
            <td style={styles.td}>{c.application.purpose}</td>
            <td style={styles.td}>${c.truth.current_state?.salary?.toLocaleString() || 0}</td>
            <td style={styles.td}>{((c.truth.current_state?.dti || 0) * 100).toFixed(1)}%</td>
            <td style={styles.td}>{c.truth.current_state?.credit_score || 0}</td>
            <td style={styles.td}>${c.truth.current_state?.checking_balance?.toLocaleString() || 0}</td>
            <td style={styles.td}><span style={{ ...styles.badge, background: ALIGNMENT_COLORS[c.label.alignment_level] }}>{c.label.alignment_level}</span></td>
            <td style={styles.td}><span style={{ color: c.label.expected_outcome === "APPROVE" ? "#10b981" : "#ef4444", fontWeight: 600 }}>{c.label.expected_outcome}</span></td>
            <td style={styles.td}><span style={{ color: FRAUD_COLORS[c.label.fraud_risk_level] }}>{c.label.fraud_risk_level}</span></td>
          </tr>))}</tbody>
        </table>
      </div>
      <div style={styles.tableFooter}>Showing {sortedCases.length} of {cases.length} cases</div>
    </div>
  );
}
function Th({ label, sortKey, sortConfig, onSort }) {
  const isActive = sortConfig.key === sortKey;
  return (<th onClick={() => onSort(sortKey)} style={{ ...styles.th, cursor: 'pointer', background: isActive ? '#f1f5f9' : 'white' }}>{label}{isActive && <span style={{ marginLeft: 4 }}>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}</th>);
}

// ─── 3. STYLES ─────────────────────────────────────────────
const ALIGNMENT_COLORS = { A0: "#10b981", A1: "#3b82f6", A2: "#f59e0b", A3: "#f97316", A4: "#ef4444", A5: "#7c2d12" };
const FRAUD_COLORS = { NONE: "#10b981", LOW: "#3b82f6", MODERATE: "#f59e0b", HIGH: "#f97316", CRITICAL: "#ef4444" };
const OUTCOME_ICONS = { APPROVE: "✓", DECLINE: "✗", MANUAL_REVIEW: "?" };
const styles = {
  app: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#f8fafc", minHeight: "100vh" },
  header: { padding: "24px 32px", background: "white", borderBottom: "1px solid #e2e8f0" },
  title: { margin: 0, fontSize: 24, color: "#0f172a" },
  subtitle: { margin: "4px 0 0", color: "#64748b", fontSize: 14 },
  layout: { display: "flex", minHeight: "calc(100vh - 80px)" },
  sidebar: { width: 320, padding: 16, background: "white", borderRight: "1px solid #e2e8f0", overflowY: "auto", display: "flex", flexDirection: "column" },
  main: { flex: 1, padding: 24, overflowY: "auto" },
  caseCard: { padding: 12, marginBottom: 8, borderRadius: 6, cursor: "pointer", transition: "all 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardMeta: { fontSize: 12, color: "#64748b", marginBottom: 4 },
  cardOutcome: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 },
  cardDifficulty: { color: "#94a3b8", fontSize: 11, textTransform: "uppercase" },
  generatorPanel: { marginTop: "auto", padding: 16, background: "#f1f5f9", borderRadius: 6, border: "1px solid #e2e8f0" },
  detail: { background: "white", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" },
  tabs: { display: "flex", borderBottom: "1px solid #e2e8f0", padding: "0 16px", overflowX: "auto" },
  tab: { padding: "12px 20px", background: "none", border: "none", cursor: "pointer", fontSize: 14, whiteSpace: "nowrap" },
  tabContent: { padding: 24 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 },
  panel: { padding: 16, background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0" },
  panelTitle: { margin: "0 0 12px", fontSize: 14, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5 },
  kvRow: { display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #e2e8f0", fontSize: 14 },
  metricCard: { padding: 16, background: "white", borderRadius: 6, border: "1px solid #e2e8f0" },
  badge: { padding: "2px 8px", borderRadius: 10, color: "white", fontSize: 11, fontWeight: 700 },
  timelineHeader: { display: "flex", alignItems: "center", marginBottom: 16, fontSize: 13 },
  legendDot: { width: 12, height: 12, borderRadius: "50%", background: "#10b981", marginRight: 6 },
  timeline: { position: "relative" },
  timelineRow: { display: "flex", marginBottom: 16, alignItems: "flex-start" },
  timelineDate: { width: 100, fontSize: 13, color: "#64748b", paddingTop: 4 },
  timelineDot: { width: 24, display: "flex", justifyContent: "center" },
  dot: { width: 12, height: 12, borderRadius: "50%", marginTop: 6 },
  timelineContent: { flex: 1, paddingLeft: 12 },
  eventType: { fontWeight: 600, fontSize: 14, marginBottom: 2 },
  eventDetails: { fontSize: 13, color: "#475569" },
  alignmentSummary: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  alignmentChip: { padding: "6px 12px", borderRadius: 16, fontSize: 13, display: "flex", alignItems: "center" },
  findingsList: { display: "flex", flexDirection: "column", gap: 12 },
  finding: { padding: 16, background: "#f8fafc", borderRadius: 6 },
  findingHeader: { display: "flex", alignItems: "center", marginBottom: 8 },
  findingDetails: { margin: 0, fontSize: 14, color: "#334155", lineHeight: 1.5 },
  evidenceCard: { marginBottom: 16, border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" },
  evidenceHeader: { display: "flex", alignItems: "center", padding: "10px 16px", background: "#f1f5f9", gap: 12, fontSize: 14 },
  evidenceDate: { color: "#64748b", fontSize: 12 },
  fidelityBadge: { marginLeft: "auto", padding: "2px 8px", background: "#dbeafe", borderRadius: 10, fontSize: 11, color: "#1e40af" },
  evidenceFields: { padding: 16 },
  evidenceRow: { display: "flex", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 },
  evidenceKey: { width: 200, color: "#64748b" },
  evidenceValue: { flex: 1, color: "#0f172a", fontFamily: "monospace", whiteSpace: "pre-wrap" },
  decisionBanner: { display: "flex", alignItems: "center", padding: 20, borderRadius: 6, marginBottom: 20 },
  comparisonRow: { display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #e2e8f0", fontSize: 14 },
  comparisonLabel: { width: 140, color: "#64748b" },
  comparisonValue: { minWidth: 80 },
  select: { width: "100%", padding: "8px", marginBottom: "8px", borderRadius: "4px", border: "1px solid #cbd5e1" },
  seedInput: { width: "100%", padding: "8px", marginBottom: "8px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: 14 },
  btnPrimary: { width: "100%", padding: "10px", background: "#2563eb", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: 600, marginBottom: "8px" },
  btnSecondary: { width: "100%", padding: "8px", background: "white", color: "#475569", border: "1px solid #cbd5e1", borderRadius: "4px", cursor: "pointer", fontSize: "12px", marginBottom: "8px" },
  tableToolbar: { display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap: 12 },
  filterInput: { flex: 1, padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: 14 },
  btnCSV: { padding: '8px 16px', background: '#059669', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 },
  tableContainer: { overflowX: 'auto', background: 'white', borderRadius: '6px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '12px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: 600, color: '#475569', background: '#f8fafc' },
  td: { padding: '10px 12px', borderBottom: '1px solid #f1f5f9' },
  tableRow: { transition: 'background 0.15s' },
  tableFooter: { marginTop: 12, color: '#64748b', fontSize: 13, textAlign: 'right' }
};

// ─── 4. MAIN COMPONENT ─────────────────────────────────────
export default function FraudCaseExplorer() {
  const [cases, setCases] = useState(INITIAL_CASES);
  const [selectedId, setSelectedId] = useState(INITIAL_CASES[0].id);
  const [activeTab, setActiveTab] = useState("overview");
  const [genConfig, setGenConfig] = useState({ corruptionType: "NONE", severity: "LOW", count: 1, seed: "", adversarial: false });
  const seedValue = genConfig.seed.trim() === "" ? undefined : genConfig.seed.trim();
  const selectedCase = cases.find((c) => c.id === selectedId) || cases[0];
  const handleGenerate = () => {
    const newCases = [];
    for (let i = 0; i < genConfig.count; i++) {
      let type = genConfig.corruptionType;
      let sev = genConfig.severity;
      if (type === "MIXED") {
        const c = generateBlendedCase(i, CONFIG, seedValue, genConfig.adversarial);
        newCases.push(c);
        continue;
      }
      const caseSeed = seedValue !== undefined ? `${seedValue}-${i}` : undefined;
      newCases.push(generateCase(i, CONFIG, type, sev, caseSeed));
    }
    setCases([...cases, ...newCases]);
    setSelectedId(newCases[0].id);
    setActiveTab("data_table");
  };
  const handleValidate = () => {
    const stats = calculateStatistics(cases);
    exportStatistics(stats);
    alert("Validation report downloaded! Check your downloads folder.");
  };
  const handleGenerateBlended = () => {
    const newCases = [];
    const count = 100;
    for (let i = 0; i < count; i++) newCases.push(generateBlendedCase(i, CONFIG, seedValue, genConfig.adversarial));
    setCases([...cases, ...newCases]);
    setSelectedId(newCases[0].id);
    setActiveTab("data_table");
  };
  const exportMLDataset = () => {
    const csvContent = casesToCsv(cases);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `ml_dataset_${cases.length}_cases.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.title}>Synthetic Case Explorer</h1>
        <p style={styles.subtitle}>Alignment-driven underwriting visualization · {cases.length} cases</p>
      </header>
      <div style={styles.layout}>
        <aside style={styles.sidebar}>
          {cases.slice().reverse().map((c) => (<CaseCard key={c.id} caseData={c} selected={c.id === selectedId} onClick={() => { setSelectedId(c.id); setActiveTab("overview"); }} />))}
          <div style={styles.generatorPanel}>
            <h3 style={styles.panelTitle}>Generate New Cases</h3>
            <select style={styles.select} value={genConfig.corruptionType} onChange={e => setGenConfig({...genConfig, corruptionType: e.target.value})}>
              <option value="NONE">Clean (A0)</option>
              <option value="TIMING_DRIFT">Timing Drift (A1)</option>
              <option value="INFLATION">Income Inflation (A3/A4)</option>
              <option value="CONCEALMENT">Debt Concealment (A3/A4)</option>
              <option value="FABRICATION">Fabrication (A4)</option>
              <option value="BUST_OUT">Synthetic Identity / Bust-Out (A5)</option>
              <option value="EVIDENCE_TAMPERING">Evidence Tampering (A4)</option>
              <option value="INCOHERENT">Incoherent World (A3 Negative Control)</option>
              <option value="MIXED">Realistic Mix (85% Good, 15% Fraud)</option>
            </select>
            <select style={styles.select} value={genConfig.severity} onChange={e => setGenConfig({...genConfig, severity: e.target.value})}>
              <option value="LOW">Low Severity</option>
              <option value="MEDIUM">Medium Severity</option>
              <option value="HIGH">High Severity</option>
            </select>
            <select style={styles.select} value={genConfig.count} onChange={e => setGenConfig({...genConfig, count: parseInt(e.target.value)})}>
              <option value="1">Generate 1</option>
              <option value="10">Generate 10</option>
              <option value="50">Generate 50</option>
              <option value="100">Generate 100</option>
            </select>
            <input type="text" placeholder="Seed (optional)" value={genConfig.seed} onChange={e => setGenConfig({...genConfig, seed: e.target.value})} style={styles.seedInput} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
              <input type="checkbox" checked={genConfig.adversarial} onChange={e => setGenConfig({...genConfig, adversarial: e.target.checked})} />
              Adversarial mode (fraud targets weak profiles)
            </label>
            <button style={styles.btnPrimary} onClick={handleGenerate}>Generate Cases</button>
            <button style={{ ...styles.btnPrimary, background: '#7c3aed' }} onClick={handleGenerateBlended}>Generate Blended 100 (85% Clean)</button>
            <button style={styles.btnSecondary} onClick={handleValidate}>Export Validation Stats</button>
            <button style={styles.btnSecondary} onClick={exportMLDataset}>Export ML Dataset CSV</button>
          </div>
        </aside>
        <main style={styles.main}>
          <CaseDetail caseData={selectedCase} activeTab={activeTab} setActiveTab={setActiveTab} cases={cases} />
        </main>
      </div>
    </div>
  );
}
function CaseCard({ caseData, selected, onClick }) {
  const { applicant, label } = caseData;
  return (<div onClick={onClick} style={{ ...styles.caseCard, borderLeft: `4px solid ${ALIGNMENT_COLORS[label.alignment_level]}`, background: selected ? "#f0f9ff" : "white" }}>
    <div style={styles.cardHeader}><strong>{applicant.name}</strong><span style={{ ...styles.badge, background: ALIGNMENT_COLORS[label.alignment_level] }}>{label.alignment_level}</span></div>
    <div style={styles.cardMeta}>Age {applicant.age} · ${caseData.application.loan_amount.toLocaleString()}</div>
    <div style={styles.cardOutcome}><span style={{ color: FRAUD_COLORS[label.fraud_risk_level], fontWeight: 600 }}>{label.expected_outcome}</span><span style={styles.cardDifficulty}>{label.difficulty}</span></div>
  </div>);
}
function CaseDetail({ caseData, activeTab, setActiveTab, cases }) {
  const tabs = ["overview", "timeline", "alignment", "evidence", "truth_graph", "metadata", "decision", "data_table"];
  return (
    <div style={styles.detail}>
      <div style={styles.tabs}>{tabs.map((tab) => (<button key={tab} onClick={() => setActiveTab(tab)} style={{ ...styles.tab, borderBottom: activeTab === tab ? "3px solid #2563eb" : "3px solid transparent", color: activeTab === tab ? "#2563eb" : "#64748b", fontWeight: activeTab === tab ? 600 : 400 }}>{tab.replace('_', ' ').charAt(0).toUpperCase() + tab.replace('_', ' ').slice(1)}</button>))}</div>
      <div style={styles.tabContent}>
        {activeTab === "overview" && <OverviewTab caseData={caseData} />}
        {activeTab === "timeline" && <TimelineTab caseData={caseData} />}
        {activeTab === "alignment" && <AlignmentTab caseData={caseData} />}
        {activeTab === "evidence" && <EvidenceTab caseData={caseData} />}
        {activeTab === "truth_graph" && <TruthGraphTab caseData={caseData} />}
        {activeTab === "metadata" && <MetadataTab caseData={caseData} />}
        {activeTab === "decision" && <DecisionTab caseData={caseData} />}
        {activeTab === "data_table" && <DataTableTab cases={cases} />}
      </div>
    </div>
  );
}
function OverviewTab({ caseData }) {
  const { applicant, application, truth, presentation, label } = caseData;
  const truthState = truth.current_state;
  const presState = presentation.current_state;
  const meta = caseData.application_metadata;
  return (
    <div>
      <div style={styles.grid2}>
        <MetricCard title="Alignment Level" value={label.alignment_level} color={ALIGNMENT_COLORS[label.alignment_level]} subtitle={label.alignment_level === "A0" ? "Aligned" : label.alignment_level === "A1" ? "Benign Variance" : "Inconsistency"} />
        <MetricCard title="Fraud Risk" value={label.fraud_risk_level} color={FRAUD_COLORS[label.fraud_risk_level]} />
        <MetricCard title="Expected Outcome" value={label.expected_outcome} color={label.expected_outcome === "APPROVE" ? "#10b981" : label.expected_outcome === "MANUAL_REVIEW" ? "#f59e0b" : "#ef4444"} icon={OUTCOME_ICONS[label.expected_outcome]} />
        <MetricCard title="Coherence" value={label.case_coherence_status?.replace(/_/g, " ")} color="#64748b" />
      </div>
      <div style={styles.grid2}>
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Applicant</h3>
          <div style={styles.kvRow}><span>Name:</span><strong>{applicant.name}</strong></div>
          <div style={styles.kvRow}><span>Age:</span><strong>{applicant.age}</strong></div>
          <div style={styles.kvRow}><span>SSN (last 4):</span><strong>***-**-{applicant.ssn_last4}</strong></div>
          <div style={styles.kvRow}><span>Persona:</span><strong>{truthState.persona?.replace(/_/g, " ")}</strong></div>
          <div style={styles.kvRow}><span>Regime:</span><strong>{truthState.regime?.replace(/_/g, " ")}</strong></div>
          <div style={styles.kvRow}><span>Tenure Stability:</span><strong>{truthState.tenure_stability}</strong></div>
          <div style={styles.kvRow}><span>Loan:</span><strong>${application.loan_amount.toLocaleString()}</strong></div>
          <div style={styles.kvRow}><span>Purpose:</span><strong>{application.purpose}</strong></div>
          {meta && <div style={styles.kvRow}><span>Submitted:</span><strong>{new Date(meta.submitted).toLocaleString()}</strong></div>}
        </div>
        <div style={styles.panel}><h3 style={styles.panelTitle}>Truth vs Presentation</h3><ComparisonRow label="Employer" truth={truthState.employer} pres={presState.employer} /><ComparisonRow label="Salary" truth={`$${truthState.salary?.toLocaleString()}`} pres={`$${presState.salary?.toLocaleString()}`} /><ComparisonRow label="Checking" truth={`$${truthState.checking_balance?.toLocaleString()}`} pres={`$${presState.checking_balance?.toLocaleString()}`} /><ComparisonRow label="Obligations" truth={`$${truthState.monthly_obligations}`} pres={`$${presState.monthly_obligations}`} /><ComparisonRow label="Stated DTI" truth={truthState.dti ? `${(truthState.dti * 100).toFixed(1)}%` : "—"} pres={presState.stated_dti ? `${(presState.stated_dti * 100).toFixed(1)}%` : presState.dti ? `${(presState.dti * 100).toFixed(1)}%` : "—"} /></div>
      </div>
    </div>
  );
}
function TimelineTab({ caseData }) {
  const truthEvents = caseData.truth.events;
  return (
    <div>
      <div style={styles.timelineHeader}><div style={styles.legendDot} /><span style={{ marginRight: 20 }}>Truth Events</span></div>
      <div style={styles.timeline}>
        {truthEvents.map((ev, i) => (
          <div key={i} style={styles.timelineRow}>
            <div style={styles.timelineDate}>{ev.t}</div>
            <div style={styles.timelineDot}><div style={{ ...styles.dot, background: "#10b981" }} /></div>
            <div style={styles.timelineContent}>
              <div style={styles.eventType}>{ev.type.replace(/_/g, " ")}</div>
              <div style={styles.eventDetails}>{ev.entity && <span>{ev.entity} · </span>}{ev.salary && <span>${ev.salary.toLocaleString()}/yr</span>}{ev.payment && <span>${ev.payment}/mo</span>}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function AlignmentTab({ caseData }) {
  return (
    <div>
      <div style={styles.alignmentSummary}>{caseData.alignment_findings.map((f, i) => (<div key={i} style={{ ...styles.alignmentChip, background: ALIGNMENT_COLORS[f.level] + "20", border: `1px solid ${ALIGNMENT_COLORS[f.level]}` }}><span style={{ fontWeight: 700, color: ALIGNMENT_COLORS[f.level] }}>{f.level}</span><span style={{ marginLeft: 8 }}>{f.dimension}</span></div>))}</div>
      <div style={styles.findingsList}>{caseData.alignment_findings.map((f, i) => (<div key={i} style={{ ...styles.finding, borderLeft: `4px solid ${ALIGNMENT_COLORS[f.level]}` }}><div style={styles.findingHeader}><span style={{ ...styles.badge, background: ALIGNMENT_COLORS[f.level] }}>{f.level}</span><strong style={{ marginLeft: 12, textTransform: "capitalize" }}>{f.dimension.replace(/_/g, " ")}</strong><span style={{ marginLeft: "auto", color: "#64748b", fontStyle: "italic" }}>{f.status.replace(/_/g, " ")}</span></div><p style={styles.findingDetails}>{f.details}</p></div>))}</div>
    </div>
  );
}
function TruthGraphTab({ caseData }) {
  const findings = caseData.ground_truth_findings || [];
  if (findings.length === 0) {
    return <div style={{ color: "#64748b" }}>No ground-truth deltas. Case is perfectly aligned (A0).</div>;
  }
  return (
    <div>
      <p style={{ color: "#64748b", marginBottom: 16, fontSize: 14 }}>
        Each card shows the exact delta between Claimed Truth (C), World Truth (S<sub>t</sub>), or Evidence (E), plus the evidence citations that prove it.
      </p>
      <div style={styles.findingsList}>
        {findings.map((f, i) => (
          <div key={i} style={{ ...styles.finding, borderLeft: `4px solid ${ALIGNMENT_COLORS[f.classification]}` }}>
            <div style={styles.findingHeader}>
              <span style={{ ...styles.badge, background: ALIGNMENT_COLORS[f.classification] }}>{f.classification}</span>
              <strong style={{ marginLeft: 12, textTransform: "capitalize" }}>{f.type.replace(/_/g, " ")}</strong>
              <span style={{ marginLeft: "auto", color: "#64748b", fontStyle: "italic" }}>{f.target_layer.replace(/_/g, " ")}</span>
            </div>
            <p style={styles.findingDetails}>{f.details}</p>
            <div style={{ marginTop: 8, fontSize: 13 }}>
              <div style={{ display: "flex", gap: 24, marginBottom: 8 }}>
                {f.claimed_value !== null && f.claimed_value !== undefined && (
                  <div><span style={{ color: "#64748b" }}>Claimed:</span> <strong>{typeof f.claimed_value === "number" ? `$${f.claimed_value.toLocaleString()}` : String(f.claimed_value)}</strong></div>
                )}
                {f.true_value !== null && f.true_value !== undefined && (
                  <div><span style={{ color: "#64748b" }}>True:</span> <strong>{typeof f.true_value === "number" ? `$${f.true_value.toLocaleString()}` : String(f.true_value)}</strong></div>
                )}
              </div>
              <div style={{ color: "#475569", fontWeight: 600, marginBottom: 4 }}>Evidence citations:</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: "#334155" }}>
                {f.evidence_citations.map((c, j) => (
                  <li key={j}>
                    <strong>{c.source.replace(/_/g, " ")}</strong>{c.field ? `.${c.field.replace(/_/g, " ")}` : ""}
                    {c.value !== undefined && c.value !== null && (
                      <span style={{ color: "#64748b", marginLeft: 8 }}>= {typeof c.value === "object" ? JSON.stringify(c.value) : String(c.value)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvidenceTab({ caseData }) {
  const docMeta = caseData.application_metadata?.documents || [];
  const docMetaBySource = Object.fromEntries(docMeta.map(d => [d.source, d]));
  return (
    <div>{caseData.evidence.map((ev, i) => {
      const doc = docMetaBySource[ev.source];
      return (
        <div key={i} style={styles.evidenceCard}>
          <div style={styles.evidenceHeader}>
            <strong>{ev.source.replace(/_/g, " ")}</strong>
            <span style={styles.evidenceDate}>{ev.date}</span>
            <span style={styles.fidelityBadge}>Fidelity: {(ev.fidelity * 100).toFixed(0)}%</span>
          </div>
          {doc && (
            <div style={{ padding: "8px 16px", background: "#f8fafc", fontSize: 12, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
              Document created {doc.days_before_submission} days before submission via {doc.pdf_generator}
            </div>
          )}
          <div style={styles.evidenceFields}>{Object.entries(ev.fields).map(([key, val]) => (<div key={key} style={styles.evidenceRow}><span style={styles.evidenceKey}>{key.replace(/_/g, " ")}</span><span style={styles.evidenceValue}>{typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)}</span></div>))}</div>
        </div>
      );
    })}</div>
  );
}
function MetadataTab({ caseData }) {
  const meta = caseData.application_metadata;
  if (!meta) return <div style={{ color: "#64748b" }}>No application metadata available.</div>;
  return (
    <div>
      <div style={styles.grid2}>
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Submission</h3>
          <div style={styles.kvRow}><span>Timestamp:</span><strong>{new Date(meta.submitted).toLocaleString()}</strong></div>
          <div style={styles.kvRow}><span>Hour:</span><strong>{meta.hour_of_day}</strong></div>
          <div style={styles.kvRow}><span>Day of week:</span><strong>{meta.day_of_week}</strong></div>
          <div style={styles.kvRow}><span>Business hours:</span><strong>{meta.is_business_hours ? "Yes" : "No"}</strong></div>
        </div>
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Network</h3>
          <div style={styles.kvRow}><span>IP:</span><strong>{meta.ip_address}</strong></div>
          <div style={styles.kvRow}><span>Risk score:</span><strong>{meta.ip_risk_score}</strong></div>
          <div style={styles.kvRow}><span>ISP:</span><strong>{meta.isp}</strong></div>
          <div style={styles.kvRow}><span>VPN:</span><strong>{meta.is_vpn ? "Yes" : "No"}</strong></div>
          <div style={styles.kvRow}><span>TOR:</span><strong>{meta.is_tor ? "Yes" : "No"}</strong></div>
        </div>
      </div>
      <div style={styles.grid2}>
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Behavioral</h3>
          <div style={styles.kvRow}><span>Typing speed:</span><strong>{meta.typing_speed_wpm} WPM</strong></div>
          <div style={styles.kvRow}><span>Copy-pasted fields:</span><strong>{meta.fields_copy_pasted}</strong></div>
          <div style={styles.kvRow}><span>Session duration:</span><strong>{meta.session_duration_seconds} sec</strong></div>
          <div style={styles.kvRow}><span>Used autofill:</span><strong>{meta.used_autofill ? "Yes" : "No"}</strong></div>
        </div>
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Device</h3>
          <div style={styles.kvRow}><span>Fingerprint:</span><strong style={{ fontFamily: "monospace", fontSize: 12 }}>{meta.device_fingerprint}</strong></div>
        </div>
      </div>
      <div style={styles.panel}>
        <h3 style={styles.panelTitle}>Document Metadata</h3>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #e2e8f0" }}>
              <th style={{ padding: "8px" }}>Source</th>
              <th style={{ padding: "8px" }}>Created</th>
              <th style={{ padding: "8px" }}>Modified</th>
              <th style={{ padding: "8px" }}>Days before submission</th>
              <th style={{ padding: "8px" }}>PDF generator</th>
            </tr>
          </thead>
          <tbody>
            {meta.documents.map((d, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px" }}>{d.source.replace(/_/g, " ")}</td>
                <td style={{ padding: "8px" }}>{d.created}</td>
                <td style={{ padding: "8px" }}>{d.modified}</td>
                <td style={{ padding: "8px" }}>{d.days_before_submission}</td>
                <td style={{ padding: "8px" }}>{d.pdf_generator}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function DecisionTab({ caseData }) {
  const { label } = caseData;
  return (
    <div>
      <div style={{ ...styles.decisionBanner, background: label.expected_outcome === "APPROVE" ? "#ecfdf5" : "#fef2f2", borderLeft: `6px solid ${label.expected_outcome === "APPROVE" ? "#10b981" : "#ef4444"}` }}>
        <div style={{ fontSize: 32, marginRight: 16 }}>{OUTCOME_ICONS[label.expected_outcome]}</div>
        <div><div style={{ fontSize: 20, fontWeight: 700 }}>{label.expected_outcome}</div><div style={{ color: "#64748b" }}>{label.coherence_status.replace(/_/g, " ")}</div></div>
      </div>
      {label.reason && <div style={{ ...styles.panel, marginBottom: 16, background: label.expected_outcome === "APPROVE" ? "#f0fdf4" : label.expected_outcome === "MANUAL_REVIEW" ? "#fffbeb" : "#fef2f2", borderLeft: `4px solid ${label.expected_outcome === "APPROVE" ? "#10b981" : label.expected_outcome === "MANUAL_REVIEW" ? "#f59e0b" : "#ef4444"}` }}><h3 style={styles.panelTitle}>Decision Reason</h3><div style={{ fontSize: 15, textTransform: "capitalize" }}>{label.reason}</div></div>}
      <div style={styles.grid2}>
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Risk Assessment</h3>
          <div style={styles.kvRow}><span>Alignment Level:</span><strong>{label.alignment_level}</strong></div>
          <div style={styles.kvRow}><span>Fraud Risk:</span><strong style={{ color: FRAUD_COLORS[label.fraud_risk_level] }}>{label.fraud_risk_level}</strong></div>
          <div style={styles.kvRow}><span>Coherence:</span><strong>{label.coherence_status.replace(/_/g, " ")}</strong></div>
          <div style={styles.kvRow}><span>Case Coherence:</span><strong>{label.case_coherence_status?.replace(/_/g, " ")}</strong></div>
          <div style={styles.kvRow}><span>Difficulty:</span><strong>{label.difficulty}</strong></div>
        </div>
        <div style={styles.panel}><h3 style={styles.panelTitle}>Conditions</h3>{label.conditions.length === 0 ? (<div style={{ color: "#10b981", fontStyle: "italic" }}>None — clean case</div>) : (<ul style={{ margin: 0, paddingLeft: 20 }}>{label.conditions.map((c, i) => <li key={i} style={{ marginBottom: 8 }}>{c}</li>)}</ul>)}</div>
      </div>
    </div>
  );
}
function MetricCard({ title, value, color, subtitle, icon }) {
  return (<div style={{ ...styles.metricCard, borderTop: `4px solid ${color}` }}><div style={{ color: "#64748b", fontSize: 13, marginBottom: 4 }}>{title}</div><div style={{ fontSize: 24, fontWeight: 700, color }}>{icon && <span style={{ marginRight: 8 }}>{icon}</span>}{value}</div>{subtitle && <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>{subtitle}</div>}</div>);
}
function ComparisonRow({ label, truth, pres }) {
  const matches = truth === pres || truth === "—";
  return (<div style={styles.comparisonRow}><span style={styles.comparisonLabel}>{label}</span><span style={{ ...styles.comparisonValue, color: "#10b981" }}>{truth}</span><span style={{ color: "#94a3b8" }}>→</span><span style={{ ...styles.comparisonValue, color: matches ? "#10b981" : "#ef4444", fontWeight: matches ? 400 : 600 }}>{pres}</span><span style={{ marginLeft: "auto", fontSize: 12, color: matches ? "#10b981" : "#ef4444" }}>{matches ? "✓" : "⚠"}</span></div>);
}
