import {
    expectedScore,
    EloTracker,
    APPROACH_IDS,
    stripReasoningArtifacts,
} from "../src/server/genaiEval";

describe("stripReasoningArtifacts", () => {
    test("removes think-open redacted_thinking-close wrapper", () => {
        const raw =
            "<think>\ninternal\n</redacted_thinking>\n\nFinal answer.";
        expect(stripReasoningArtifacts(raw)).toBe("Final answer.");
    });

    test("removes empty think wrapper (only newlines inside)", () => {
        const raw =
            "<" +
            "think" +
            ">" +
            "\n\n</" +
            "redacted" +
            "_" +
            "thinking" +
            ">\n\nA CRDT";
        expect(stripReasoningArtifacts(raw)).toBe("A CRDT");
    });

    test("removes think-open think-close wrapper", () => {
        const raw =
            "<" +
            "think" +
            ">" +
            "\n\n</" +
            "think" +
            ">\n\nA CRDT tail";
        expect(stripReasoningArtifacts(raw)).toBe("A CRDT tail");
    });

    test("removes fully redacted_thinking blocks", () => {
        const raw =
            "<redacted_thinking>\ninternal\n</redacted_thinking>\n\nFinal answer.";
        expect(stripReasoningArtifacts(raw)).toBe("Final answer.");
    });

    test("removes thinking blocks", () => {
        expect(stripReasoningArtifacts("<thinking>x</thinking>y")).toBe("y");
    });
});

describe("ELO helpers", () => {
    test("equal ratings imply 0.5 expected score", () => {
        expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 5);
    });

    test("higher-rated player has higher expected score", () => {
        expect(expectedScore(1600, 1400)).toBeGreaterThan(0.5);
        expect(expectedScore(1400, 1600)).toBeLessThan(0.5);
    });
});

describe("EloTracker", () => {
    test("starts all approaches at same rating", () => {
        const t = new EloTracker();
        const first = t.get(APPROACH_IDS[0]);
        for (const id of APPROACH_IDS) {
            expect(t.get(id)).toBe(first);
        }
    });

    test("winner rating does not decrease after a preference", () => {
        const t = new EloTracker();
        const w = APPROACH_IDS[0];
        const l = APPROACH_IDS[1];
        const before = t.get(w);
        t.recordPreference(w, l);
        expect(t.get(w)).toBeGreaterThanOrEqual(before);
    });

    test("loser rating does not increase after a preference", () => {
        const t = new EloTracker();
        const w = APPROACH_IDS[0];
        const l = APPROACH_IDS[1];
        const before = t.get(l);
        t.recordPreference(w, l);
        expect(t.get(l)).toBeLessThanOrEqual(before);
    });
});
