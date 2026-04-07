import * as fs from "fs";
import * as path from "path";
import type { LshConfig } from "./lsh";
import type { EmbeddingKind } from "./embeddings";

export type StoredDocument = { id: string; text: string };

export type PersistedState = {
    version: 1;
    embedding: EmbeddingKind;
    documents: StoredDocument[];
    lsh: LshConfig;
};

export function loadState(filePath: string): PersistedState {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) {
        throw new Error(`store file not found: ${abs}`);
    }
    const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as PersistedState;
    if (raw.version !== 1 || !Array.isArray(raw.documents)) {
        throw new Error("invalid store format");
    }
    return raw;
}

export function saveState(filePath: string, state: PersistedState): void {
    const abs = path.resolve(filePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(state, null, 2), "utf8");
}

export function emptyState(embedding: EmbeddingKind, lsh: LshConfig): PersistedState {
    return { version: 1, embedding, documents: [], lsh: { ...lsh } };
}
