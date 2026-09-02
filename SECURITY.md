# Security Policy

## Synthetic data only

Case Explorer generates synthetic mortgage applicants. There is no real borrower, no real employer, no real account and no real credit file anywhere in this repository or in anything it produces. Names, SSN last-four values, ZIP codes, IP addresses and document metadata are drawn from configured distributions in `src/distribution_config.json`.

This project must never be pointed at real borrower data. It has no data-protection controls appropriate to personal financial information: no encryption at rest, no field-level access control, no retention policy, no consent handling and no data-subject request path. Loading real application data into the generator, the API or the analytics workbench would place that data in plain CSV files, in logs and in artifacts that are designed to be shared.

## Reporting a vulnerability

Report privately by opening a GitHub security advisory on this repository (Security tab, "Report a vulnerability"). Do not open a public issue for a security problem.

Expect an acknowledgement within a few days. Please include the affected file or endpoint, the version or commit, reproduction steps, and the impact you believe it has.

## Supported versions

| Version | Supported |
|---|---|
| `main` branch | Yes |
| Tagged releases and forks | No |

Only the current `main` branch receives fixes. There are no backports.

## Security controls in place

These controls exist in the code and are exercised in CI.

| Control | Where |
|---|---|
| API-key authentication on every route except `/api/health*`, `/api/docs` and `/api/openapi.yaml` | `src/api/middleware/auth.js`, keys from `API_KEYS` |
| Per-key rate limiting with `X-RateLimit-*` response headers | `src/api/middleware/rateLimit.js`, `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` |
| HTTP security headers | `helmet` in `src/api/app.js` |
| Request validation against versioned Zod contracts at every system boundary | `src/contracts/index.js`, `src/api/utils/validation.js` |
| Parameterised SQL only | `src/db/` |
| Append-only audit, decision, explanation, evaluation and review tables with immutability triggers that reject `UPDATE` and `DELETE` | `src/db/migrations/001_core.sql` (`reject_mutation`) |
| Hash-chained audit events, each linking the previous event hash, with chain verification exposed at `/api/health/store` | `src/decisioning/investigation/workflow.js` |
| Dependency audit at high severity and above | `npm audit --audit-level=high` in the `security` CI job |
| Secret scanning | `gitleaks/gitleaks-action` in the `security` CI job |
| Static analysis for JavaScript and Python | CodeQL in the `security` CI job |
| Container vulnerability scan, failing on critical findings | Trivy in the `build` CI job |

## Explicit non-goals

This is a portfolio and research demonstration, not a hardened service. The following are known and accepted for that scope. Do not deploy it as-is anywhere that matters.

- **The API key scheme is a single shared secret, not an identity system.** `API_KEYS` is a comma-separated list of static strings compared on each request. There are no users, roles, scopes, sessions, key rotation, expiry or revocation, and no way to attribute an action to a person. The audit trail records what happened, not who did it in any authenticated sense.
- **The in-memory store is not durable.** It implements the same interface as the PostgreSQL store so tests can run without a database, and it loses everything on restart. Its audit chain has the same lifetime.
- **The demo deployment has no authentication.** The GitHub Pages build is a static front end with no server behind it. Anything it shows is generated in the browser or read from published benchmark artifacts.
- No threat model, penetration test or formal review has been performed.

## Fraud typologies are documented for detection research

`docs/methodology/FRAUD_SCENARIO_METHODOLOGY.md` describes each corruption operator: which layer it mutates, what an underwriter can observe without ground truth, which governed rule targets it, and what label the generator assigns. The purpose is to make detection performance auditable and to let a reader check that a rule catches what it claims to catch.

The repository contains no operational fraud instructions. The typologies are parameterised mutations of synthetic records inside a simulator. Nothing here describes how to obtain, forge or submit a real document, and the evidence objects are small JSON structures with no document image, layout or binary content of any kind.
