// API_BASE_URL: where the API lives (no trailing slash).
//  - Vercel: "" (same origin; the API is served from /api on the same domain).
//  - Local dev (run-local.cmd): the page is on :8080 and the API on :3000.
// API_KEY: leave empty. If the backend has API_KEY set, the page asks for it once
// and remembers it in this browser, so the key is never published in this file.
window.APP_CONFIG = {
  API_BASE_URL: location.port === "8080" ? `http://${location.hostname}:3000` : "",
  API_KEY: ""
};
