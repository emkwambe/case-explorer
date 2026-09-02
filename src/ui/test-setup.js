// Vitest setup: jest-dom matchers for UI suites. No-op in the node environment.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
}
