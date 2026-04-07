import { buildVocabulary } from "../src/vocabulary";
import { embedTfidf, l2Normalize } from "../src/embeddings";
import { LshIndex, buildBuckets, candidateIndices, defaultLshConfig } from "../src/lsh";

describe("LSH", () => {
    it("same document hashes to same buckets", () => {
        const docs = Array.from({ length: 20 }, (_, i) => `document number ${i} about cats and dogs`);
        const v = buildVocabulary(docs);
        const vecs = docs.map((d) => l2Normalize(embedTfidf(d, v)));
        const lsh = new LshIndex(v.terms.length, defaultLshConfig());
        const buckets = buildBuckets(vecs, lsh);
        const q = vecs[5];
        const cand = candidateIndices(q, lsh, buckets);
        expect(cand.has(5)).toBe(true);
    });
});
