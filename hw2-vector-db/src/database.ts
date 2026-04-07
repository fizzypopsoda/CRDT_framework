import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { buildVocabulary, type Vocabulary } from "./vocabulary";
import { embed, l2Normalize, type EmbeddingKind } from "./embeddings";
import { cosineSimilarity } from "./similarity";
import {
    LshIndex,
    buildBuckets,
    candidateIndices,
    defaultLshConfig,
    type BucketMap,
    type LshConfig,
} from "./lsh";
import {
    loadState,
    saveState,
    emptyState,
    type PersistedState,
    type StoredDocument,
} from "./store";

export type SearchResult = { id: string; text: string; score: number; approximate: boolean };

export class VectorDatabase {
    private documents: StoredDocument[] = [];
    private embeddingKind: EmbeddingKind = "tfidf";
    private vocab: Vocabulary | null = null;
    private docVectors: Float64Array[] = [];
    private normalized: Float64Array[] = [];
    private lsh: LshIndex | null = null;
    private buckets: BucketMap = [];
    private lshConfig: LshConfig = defaultLshConfig();

    constructor(options?: { embedding?: EmbeddingKind; lsh?: Partial<LshConfig> }) {
        if (options?.embedding) this.embeddingKind = options.embedding;
        if (options?.lsh) this.lshConfig = { ...this.lshConfig, ...options.lsh };
    }

    get size(): number {
        return this.documents.length;
    }

    get embedding(): EmbeddingKind {
        return this.embeddingKind;
    }

    private rebuildIndex(): void {
        const texts = this.documents.map((d) => d.text);
        if (texts.length === 0) {
            this.vocab = null;
            this.docVectors = [];
            this.normalized = [];
            this.lsh = null;
            this.buckets = [];
            return;
        }
        this.vocab = buildVocabulary(texts);
        this.docVectors = texts.map((t) => embed(t, this.vocab!, this.embeddingKind));
        this.normalized = this.docVectors.map((v) => l2Normalize(v));
        this.lsh = new LshIndex(this.vocab!.terms.length, this.lshConfig);
        this.buckets = buildBuckets(this.normalized, this.lsh);
    }

    add(text: string): string {
        const id = randomUUID();
        this.documents.push({ id, text });
        this.rebuildIndex();
        return id;
    }

    search(queryText: string, k: number, options?: { exact?: boolean }): SearchResult[] {
        if (k < 1) throw new Error("k must be >= 1");
        if (!this.vocab || this.documents.length === 0) return [];
        const rawQ = embed(queryText, this.vocab, this.embeddingKind);
        const q = l2Normalize(rawQ);

        const n = this.documents.length;
        const allIdx = () => [...Array(n).keys()];

        let indices: number[];
        let approximate = false;
        const exact = options?.exact === true;

        if (exact || !this.lsh || this.buckets.length === 0) {
            indices = allIdx();
        } else {
            const cand = candidateIndices(q, this.lsh, this.buckets);
            indices = [...cand];
            if (indices.length === 0) {
                indices = allIdx();
            } else {
                approximate = indices.length < n;
                if (indices.length < Math.min(k, n)) {
                    indices = allIdx();
                    approximate = false;
                }
            }
        }

        const scored = indices.map((i) => ({
            i,
            score: cosineSimilarity(q, this.normalized[i]),
        }));
        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, k);
        return top.map(({ i, score }) => ({
            id: this.documents[i].id,
            text: this.documents[i].text,
            score,
            approximate,
        }));
    }

    save(filePath: string): void {
        const state: PersistedState = {
            version: 1,
            embedding: this.embeddingKind,
            documents: [...this.documents],
            lsh: { ...this.lshConfig },
        };
        saveState(filePath, state);
    }

    static load(filePath: string): VectorDatabase {
        const state = loadState(filePath);
        const db = new VectorDatabase({ embedding: state.embedding, lsh: state.lsh });
        db.documents = [...state.documents];
        db.rebuildIndex();
        return db;
    }

    static createEmpty(filePath: string, embedding: EmbeddingKind = "tfidf"): VectorDatabase {
        const db = new VectorDatabase({ embedding });
        saveState(filePath, emptyState(embedding, db.lshConfig));
        return db;
    }

    static openOrCreate(filePath: string, embedding: EmbeddingKind = "tfidf"): VectorDatabase {
        const abs = path.resolve(filePath);
        if (fs.existsSync(abs)) return VectorDatabase.load(abs);
        return VectorDatabase.createEmpty(abs, embedding);
    }
}
