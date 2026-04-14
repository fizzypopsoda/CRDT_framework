import { config as loadEnv } from "dotenv";
import { chromium } from "playwright";
import { resolveChatProvider, chatComplete } from "./llm-providers.mjs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, "..", ".env") });

const BASE = process.env.LLM_ASSISTANT_BASE_URL || "http://127.0.0.1:8080";
const MAX_STEPS = Math.min(8, Math.max(1, Number(process.env.LLM_ASSISTANT_STEPS) || 3));
const HEADLESS = process.env.LLM_ASSISTANT_HEADLESS !== "0";

const GOAL =
    process.argv.slice(2).join(" ").trim() ||
    "Confirm the pixel canvas page loaded and describe the toolbar.";

function stripCodeFence(s) {
    let t = s.trim();
    const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    if (m) t = m[1].trim();
    return t;
}

function parsePlan(reply) {
    const raw = stripCodeFence(reply);
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function snapshotPage(page) {
    const title = await page.title();
    const url = page.url();
    let textSnippet = "";
    try {
        textSnippet = (await page.locator("body").innerText()).slice(0, 2500);
    } catch {
        textSnippet = "";
    }
    return { title, url, textSnippet };
}

const SYSTEM = `You are a cautious browser agent for a "Pixel Canvas" test site.
You MUST respond with a single JSON object only (no markdown), shape:
{"thought":"one sentence","action":"done"|"click"|"goto"|"wait","selector":null or string,"href":null or string,"ms":number}

Rules:
- Use action "done" when the user goal is met or impossible.
- For "click", selector must be a simple CSS selector. Valid examples: #modeToggle, #colorPicker, canvas#canvas, a[href="/logout"]
- For "goto", set href to a full URL (only same-origin paths like ${BASE}/ are allowed).
- For "wait", ms between 200 and 3000.
- Never invent IDs; prefer #modeToggle, #colorPicker, canvas#canvas if relevant.`;

async function planStep(provider, goal, snap) {
    const user = `User goal: ${goal}\n\nCurrent page (JSON):\n${JSON.stringify(snap)}`;
    const reply = await chatComplete(
        provider,
        [
            { role: "system", content: SYSTEM },
            { role: "user", content: user },
        ],
        { max_tokens: 400, temperature: 0.2 }
    );
    return { reply, plan: parsePlan(reply) };
}

async function runAction(page, plan, baseOrigin) {
    const { action, selector, href, ms } = plan;
    if (action === "done") return;
    if (action === "wait" && typeof ms === "number") {
        const d = Math.min(3000, Math.max(200, ms));
        await new Promise((r) => setTimeout(r, d));
        return;
    }
    if (action === "goto" && href) {
        const u = new URL(href, baseOrigin);
        if (u.origin !== new URL(baseOrigin).origin) {
            console.warn("Refusing cross-origin goto:", href);
            return;
        }
        await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
        return;
    }
    if (action === "click" && selector) {
        await page.click(selector, { timeout: 8000 });
        return;
    }
    console.warn("Unknown or incomplete action:", action, plan);
}

async function main() {
    const provider = resolveChatProvider();
    if (!provider) {
        console.error("Set GROQ_API_KEY (and optionally LLM_MODEL) for the assistant.");
        process.exit(1);
    }

    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20_000 });

    for (let step = 0; step < MAX_STEPS; step++) {
        const snap = await snapshotPage(page);
        const { reply, plan } = await planStep(provider, GOAL, snap);
        if (!plan) {
            console.error("Step", step + 1, "— could not parse JSON. Raw:\n", reply);
            break;
        }
        console.log(`\n--- Step ${step + 1} ---\n`, JSON.stringify(plan, null, 2));
        if (plan.action === "done") break;
        try {
            await runAction(page, plan, BASE);
        } catch (e) {
            console.error("Action failed:", e.message);
        }
    }

    const finalSnap = await snapshotPage(page);
    const summary = await chatComplete(
        provider,
        [
            {
                role: "user",
                content: `In one or two sentences, did we achieve this goal: "${GOAL}"? Final page title: "${finalSnap.title}".`,
            },
        ],
        { max_tokens: 200, temperature: 0.3 }
    );
    console.log("\n--- LLM summary ---\n", summary);
    await browser.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
