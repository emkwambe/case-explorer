# Known issues

## Open moderate dependency advisories (dev and test tooling only)

Last checked with `npm audit` on 2026-10-14. CI gates on `npm audit --audit-level=high`, which passes; the five moderate advisories below remain after a plain `npm audit fix`.

| Package | Installed | Advisory | Pulled in by |
|---|---|---|---|
| `vitest` | 4.1.10 | GHSA-82fw-gwwq-j7x9: path traversal / arbitrary file read via the `@vitest/mocker` redirect mock | devDependency (test runner) |
| `@vitest/mocker` | 4.1.10 | GHSA-82fw-gwwq-j7x9 | `vitest` |
| `@vitest/coverage-v8` | 4.1.10 | Flagged through `vitest` | devDependency (coverage) |
| `qs` | 6.15.1 | GHSA-q8mj-m7cp-5q26, GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g (denial of service) | `typed-rest-client` 2.3.1, a dependency of `@stryker-mutator/core` 10.0.0 |
| `typed-rest-client` | 2.3.1 | Flagged through its nested `qs` | `@stryker-mutator/core` (mutation testing) |

None of these packages is in the browser bundle or the API server's runtime dependencies. The server's own `qs` and `proxy-addr` (through Express) are on fixed versions (6.16.0 and 2.0.8).

**Blockers.**

- The nested `qs` can only be cleared with a major upgrade of a Stryker dependency: `typed-rest-client` 2.x to 3.x, which `@stryker-mutator/core` 10.0.0 pins. It needs a Stryker release that moves to `typed-rest-client` 3.x, or an override that has been tested against Stryker.
- The `vitest` advisory is fixed in 4.1.11, a patch release inside the `^4.1.10` range, but a plain `npm audit fix` does not apply it. Clearing it needs an explicit `npm update vitest @vitest/coverage-v8` and a full test run.
