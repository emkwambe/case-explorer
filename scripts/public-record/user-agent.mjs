// scripts/public-record/user-agent.mjs — Which User-Agent each public-record request sends.
// The declared SEC User-Agent carries a contact email, so it goes to SEC hosts only; every other
// host (FRED, the complaint database) gets a plain one.

export const PLAIN_USER_AGENT = "case-explorer public-record snapshot (build-time, manual)";
export const isSecHost = (url) => /^(www|data)\.sec\.gov$/.test(new URL(url).hostname);
export const userAgentFor = (url, secUserAgent) => (isSecHost(url) ? secUserAgent : PLAIN_USER_AGENT);
