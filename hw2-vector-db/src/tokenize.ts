const STOP = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "as", "is", "was", "are",
    "be", "been", "by", "it", "this", "that", "these", "those", "with", "from", "has", "have", "had",
]);

export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1 && !STOP.has(w));
}
