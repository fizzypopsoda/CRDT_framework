const { defineConfig, devices } = require("@playwright/test");


const port = process.env.PLAYWRIGHT_PORT || "4173";
const baseURL =
    process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const isCI = process.env.CI === "true";
const reuseExistingServer =
    process.env.PLAYWRIGHT_REUSE_SERVER === "1" && !isCI;

module.exports = defineConfig({
    testDir: "./tests/e2e",
    fullyParallel: true,
    forbidOnly: !!isCI,
    retries: isCI ? 2 : 0,
    workers: isCI ? 1 : undefined,
    reporter: isCI ? "github" : "list",
    use: {
        baseURL,
        trace: "on-first-retry",
    },
    webServer: {
        command: `AUTH_MODE=disabled PORT=${port} npm run dev`,
        url: `${baseURL}/api/health`,
        reuseExistingServer,
        timeout: 120_000,
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
