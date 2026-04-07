import { tokenize } from "./tokenize";

export type Vocabulary = {
    terms: string[];
    termToIndex: Map<string, number>;
    idf: Float64Array;
};

export function buildVocabulary(documents: string[]): Vocabulary {
    const df = new Map<string, number>();
    const n = Math.max(1, documents.length);
    for (const doc of documents) {
        const once = new Set(tokenize(doc));
        for (const w of once) df.set(w, (df.get(w) ?? 0) + 1);
    }
    const terms = [...df.keys()].sort((a, b) => a.localeCompare(b));
    const termToIndex = new Map<string, number>();
    terms.forEach((t, i) => termToIndex.set(t, i));
    const idf = new Float64Array(terms.length);
    for (let i = 0; i < terms.length; i++) {
        const d = df.get(terms[i]) ?? 1;
        idf[i] = Math.log((1 + n) / (1 + d)) + 1;
    }
    return { terms, termToIndex, idf };
}
