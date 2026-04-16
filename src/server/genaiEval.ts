import type { Express, Request, Response } from "express";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export const APPROACH_IDS = ["strict-qwen", "creative-qwen", "fast-llama"] as const;
export type ApproachId = (typeof APPROACH_IDS)[number];

type ApproachConfig = {
    id: ApproachId;
    model: string;
    temperature: number;
    system: string;
};

const APPROACHES: Record<ApproachId, ApproachConfig> = {
    "strict-qwen": {
        id: "strict-qwen",
        model: "qwen/qwen3-32b",
        temperature: 0.15,
        system:
            "You answer factual questions briefly. Use 2–4 short sentences. No markdown unless asked. " +
            "Reply with only the final answer for the user—no chain-of-thought, no XML tags, no internal reasoning.",
    },
    "creative-qwen": {
        id: "creative-qwen",
        model: "qwen/qwen3-32b",
        temperature: 0.9,
        system:
            "You give imaginative, varied answers. One short paragraph, conversational tone. " +
            "Output only the answer text—no thinking tags or hidden reasoning blocks.",
    },
    "fast-llama": {
        id: "fast-llama",
        model: "llama-3.1-8b-instant",
        temperature: 0.35,
        system: "Be extremely concise: one or two sentences max.",
    },
};

const INITIAL_ELO = 1500;
const DEFAULT_K = 32;

export function stripReasoningArtifacts(text: string): string {
    const redacted = "redacted";
    const thinking = "thinking";
    const think = "think";
    const patterns = [
        new RegExp("<" + think + ">[\\s\\S]*?<\\/" + redacted + "_" + thinking + ">", "gi"),
        new RegExp("<" + think + ">[\\s\\S]*?<\\/" + think + ">", "gi"),
        new RegExp("<" + redacted + "_" + thinking + ">[\\s\\S]*?<\\/" + redacted + "_" + thinking + ">", "gi"),
        new RegExp("<" + redacted + "_" + think + ">[\\s\\S]*?<\\/" + redacted + "_" + thinking + ">", "gi"),
        new RegExp("<thinking>[\\s\\S]*?<\\/thinking>", "gi"),
    ];
    let t = text;
    for (let pass = 0; pass < 4; pass++) {
        const before = t;
        for (const p of patterns) {
            t = t.replace(p, "");
        }
        if (t === before) break;
    }
    return t.trim();
}

export function expectedScore(ratingA: number, ratingB: number): number {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export class EloTracker {
    private readonly ratings = new Map<ApproachId, number>();

    constructor() {
        for (const id of APPROACH_IDS) this.ratings.set(id, INITIAL_ELO);
    }

    get(id: ApproachId): number {
        return this.ratings.get(id) ?? INITIAL_ELO;
    }

    recordPreference(winner: ApproachId, loser: ApproachId, K = DEFAULT_K): void {
        const rw = this.get(winner);
        const rl = this.get(loser);
        const eWin = expectedScore(rw, rl);
        const eLose = expectedScore(rl, rw);
        this.ratings.set(winner, rw + K * (1 - eWin));
        this.ratings.set(loser, rl + K * (0 - eLose));
    }

    snapshot(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const id of APPROACH_IDS) out[id] = Math.round(this.get(id) * 10) / 10;
        return out;
    }

    rankings(): { approachId: ApproachId; rating: number }[] {
        return [...APPROACH_IDS]
            .map((approachId) => ({ approachId, rating: this.get(approachId) }))
            .sort((a, b) => b.rating - a.rating);
    }
}

const elo = new EloTracker();
let defaultRoundRobin = 0;

function isApproachId(s: string): s is ApproachId {
    return (APPROACH_IDS as readonly string[]).includes(s);
}

async function groqComplete(
    apiKey: string,
    model: string,
    messages: { role: string; content: string }[],
    temperature: number,
    maxTokens: number
): Promise<string> {
    const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
        }),
    });
    if (!res.ok) {
        throw new Error(`Groq ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content?.trim() || "(empty)";
    return stripReasoningArtifacts(raw) || "(empty)";
}

async function runApproach(
    apiKey: string,
    approach: ApproachConfig,
    userPrompt: string
): Promise<string> {
    const cfg = APPROACHES[approach.id];
    return groqComplete(
        apiKey,
        cfg.model,
        [
            { role: "system", content: cfg.system },
            { role: "user", content: userPrompt },
        ],
        cfg.temperature,
        512
    );
}

function pickDefaultApproach(): ApproachId {
    const id = APPROACH_IDS[defaultRoundRobin % APPROACH_IDS.length];
    defaultRoundRobin++;
    return id;
}

const dualPairs: [ApproachId, ApproachId][] = [
    ["strict-qwen", "creative-qwen"],
    ["creative-qwen", "fast-llama"],
    ["strict-qwen", "fast-llama"],
];
let dualPairIx = 0;

function pickPairForDual(): [ApproachId, ApproachId] {
    const p = dualPairs[dualPairIx % dualPairs.length];
    dualPairIx++;
    return p;
}

export function registerGenaiEvalRoutes(app: Express): void {
    app.get("/api/genai/approaches", (_req: Request, res: Response) => {
        res.json({
            approaches: APPROACH_IDS.map((id) => ({
                id,
                model: APPROACHES[id].model,
                temperature: APPROACHES[id].temperature,
                label: id.replace(/-/g, " "),
            })),
        });
    });

    app.get("/api/genai/elo", (_req: Request, res: Response) => {
        res.json({
            ratings: elo.snapshot(),
            rankings: elo.rankings(),
        });
    });

    app.post("/api/genai", async (req: Request, res: Response) => {
        const pref = req.body?.preference;
        if (pref && typeof pref === "object") {
            const w = pref.winner;
            const l = pref.loser;
            if (typeof w !== "string" || typeof l !== "string") {
                res.status(400).json({
                    error: "preference must include winner and loser (approach id strings)",
                });
                return;
            }
            if (!isApproachId(w) || !isApproachId(l)) {
                res.status(400).json({
                    error: `Invalid approach id. Allowed: ${APPROACH_IDS.join(", ")}`,
                });
                return;
            }
            if (w === l) {
                res.status(400).json({ error: "winner and loser must differ" });
                return;
            }
            elo.recordPreference(w, l);
            res.json({
                ok: true,
                mode: "preference",
                winner: w,
                loser: l,
                ratings: elo.snapshot(),
                rankings: elo.rankings(),
            });
            return;
        }

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            res.status(503).json({ error: "GROQ_API_KEY not configured" });
            return;
        }

        const dual =
            req.query.dual === "1" ||
            req.query.dual === "true" ||
            req.body?.dual === true;

        const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
        if (!prompt.trim()) {
            res.status(400).json({ error: "Missing body.prompt (non-empty string)" });
            return;
        }

        try {
            if (dual) {
                const [idA, idB] = pickPairForDual();
                const [contentA, contentB] = await Promise.all([
                    runApproach(apiKey, APPROACHES[idA], prompt),
                    runApproach(apiKey, APPROACHES[idB], prompt),
                ]);
                res.json({
                    mode: "dual",
                    prompt,
                    responses: [
                        { approachId: idA, content: contentA },
                        { approachId: idB, content: contentB },
                    ],
                    hint: "POST /api/genai/preference with { winner, loser } (approach ids) to update ELO.",
                });
                return;
            }

            let approachId: ApproachId;
            if (typeof req.body?.approach === "string" && isApproachId(req.body.approach)) {
                approachId = req.body.approach;
            } else {
                approachId = pickDefaultApproach();
            }

            const content = await runApproach(apiKey, APPROACHES[approachId], prompt);
            res.json({
                mode: "single",
                approachId,
                content,
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(502).json({ error: msg });
        }
    });

    app.post("/api/genai/preference", (req: Request, res: Response) => {
        const w = req.body?.winner;
        const l = req.body?.loser;
        if (typeof w !== "string" || typeof l !== "string") {
            res.status(400).json({ error: "Body must include winner and loser (approach id strings)" });
            return;
        }
        if (!isApproachId(w) || !isApproachId(l)) {
            res.status(400).json({
                error: `Invalid approach id. Allowed: ${APPROACH_IDS.join(", ")}`,
            });
            return;
        }
        if (w === l) {
            res.status(400).json({ error: "winner and loser must differ" });
            return;
        }
        elo.recordPreference(w, l);
        res.json({
            ok: true,
            winner: w,
            loser: l,
            ratings: elo.snapshot(),
            rankings: elo.rankings(),
        });
    });
}
