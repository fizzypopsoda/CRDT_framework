import { tokenize } from "./tokenize";
import type { Vocabulary } from "./vocabulary";

export type EmbeddingKind = "tfidf" | "bow";

function termCounts(text: string): Map<string, number> {
    const m = new Map<string, number>();
    for (const t of tokenize(text)) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
}

export function embedTfidf(text: string, vocab: Vocabulary): Float64Array {
    const v = new Float64Array(vocab.terms.length);
    const tf = termCounts(text);
    const maxTf = Math.max(1, ...tf.values());
    for (const [word, count] of tf) {
        const idx = vocab.termToIndex.get(word);
        if (idx === undefined) continue;
        const nt = 0.5 + 0.5 * (count / maxTf);
        v[idx] = nt * vocab.idf[idx];
    }
    return v;
}

export function embedBow(text: string, vocab: Vocabulary): Float64Array {
    const v = new Float64Array(vocab.terms.length);
    const tf = termCounts(text);
    for (const [word, count] of tf) {
        const idx = vocab.termToIndex.get(word);
        if (idx === undefined) continue;
        v[idx] = count;
    }
    return v;
}

export function embed(text: string, vocab: Vocabulary, kind: EmbeddingKind): Float64Array {
    return kind === "bow" ? embedBow(text, vocab) : embedTfidf(text, vocab);
}

export function l2Normalize(v: Float64Array): Float64Array {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    const n = Math.sqrt(s) || 1e-12;
    const out = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
    return out;
}
