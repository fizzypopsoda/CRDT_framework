import { buildVocabulary } from "../src/vocabulary";
import { embedTfidf, embedBow, l2Normalize } from "../src/embeddings";
import { cosineSimilarity } from "../src/similarity";

describe("embeddings + cosine", () => {
    const docs = ["cat on mat", "dog in park", "cat sleeps"];
    const v = buildVocabulary(docs);

    it("TF-IDF gives higher similarity for overlapping terms", () => {
        const a = l2Normalize(embedTfidf("cat mat", v));
        const b = l2Normalize(embedTfidf(docs[0], v));
        const c = l2Normalize(embedTfidf(docs[1], v));
        expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
    });

    it("BoW counts appear in vector", () => {
        const x = embedBow("cat cat dog", v);
        const catIdx = v.termToIndex.get("cat");
        const dogIdx = v.termToIndex.get("dog");
        expect(catIdx).toBeDefined();
        expect(dogIdx).toBeDefined();
        expect(x[catIdx!]).toBe(2);
        expect(x[dogIdx!]).toBe(1);
    });
});
