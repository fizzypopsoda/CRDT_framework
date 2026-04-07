export function cosineSimilarity(a: Float64Array, b: Float64Array): number {
    if (a.length !== b.length) throw new Error("dimension mismatch");
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

export function rankByCosine(
    query: Float64Array,
    docVectors: Float64Array[],
    docIds: string[]
): { id: string; score: number }[] {
    const scores = docIds.map((id, i) => ({
        id,
        score: cosineSimilarity(query, docVectors[i]),
    }));
    scores.sort((x, y) => y.score - x.score);
    return scores;
}
