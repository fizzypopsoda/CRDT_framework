import { createRng, fillGaussian } from "./prng";

export type LshConfig = {
    numTables: number;
    bitsPerTable: number;
    seed: number;
};

export const defaultLshConfig = (): LshConfig => ({
    numTables: 10,
    bitsPerTable: 12,
    seed: 0x43915391,
});

export class LshIndex {
    readonly dim: number;
    readonly config: LshConfig;
    private readonly planes: Float64Array[][];

    constructor(dim: number, config: LshConfig) {
        this.dim = dim;
        this.config = { ...config };
        const rng = createRng(config.seed);
        this.planes = [];
        for (let t = 0; t < config.numTables; t++) {
            const table: Float64Array[] = [];
            for (let b = 0; b < config.bitsPerTable; b++) {
                const p = new Float64Array(dim);
                fillGaussian(rng, p);
                table.push(p);
            }
            this.planes.push(table);
        }
    }

    hashTable(v: Float64Array, tableIdx: number): string {
        const bits: number[] = [];
        const table = this.planes[tableIdx];
        for (let b = 0; b < table.length; b++) {
            let dot = 0;
            const p = table[b];
            for (let i = 0; i < v.length; i++) dot += v[i] * p[i];
            bits.push(dot >= 0 ? 1 : 0);
        }
        return bits.join("");
    }

    allHashes(v: Float64Array): string[] {
        const out: string[] = [];
        for (let t = 0; t < this.config.numTables; t++) out.push(this.hashTable(v, t));
        return out;
    }
}

export type BucketMap = Map<string, Set<number>>[];

export function buildBuckets(vectors: Float64Array[], lsh: LshIndex): BucketMap {
    const maps: BucketMap = [];
    for (let t = 0; t < lsh.config.numTables; t++) maps.push(new Map());
    for (let i = 0; i < vectors.length; i++) {
        const v = vectors[i];
        for (let t = 0; t < lsh.config.numTables; t++) {
            const key = lsh.hashTable(v, t);
            if (!maps[t].has(key)) maps[t].set(key, new Set());
            maps[t].get(key)!.add(i);
        }
    }
    return maps;
}

export function candidateIndices(queryVec: Float64Array, lsh: LshIndex, buckets: BucketMap): Set<number> {
    const cand = new Set<number>();
    for (let t = 0; t < lsh.config.numTables; t++) {
        const key = lsh.hashTable(queryVec, t);
        const s = buckets[t].get(key);
        if (s) for (const id of s) cand.add(id);
    }
    return cand;
}
