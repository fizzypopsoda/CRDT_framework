const { test, expect } = require("@playwright/test");

test.describe("Pixel canvas (smoke)", () => {
    test("home loads and shows canvas UI", async ({ page }) => {
        await page.goto("/");
        await expect(page).toHaveTitle(/Pixel/i);
        await expect(page.locator("canvas#canvas")).toBeVisible();
        await expect(page.locator("#modeToggle")).toBeVisible();
    });

    test("health endpoint responds", async ({ request }) => {
        const res = await request.get("/api/health");
        expect(res.ok()).toBeTruthy();
        const j = await res.json();
        expect(j.status).toBe("ok");
    });
});
