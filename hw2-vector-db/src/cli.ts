#!/usr/bin/env node
import { VectorDatabase } from "./database";
import type { EmbeddingKind } from "./embeddings";

function usage(): void {
    console.log(`
Usage:
  node dist/cli.js --store <path.json> add <text...>
  node dist/cli.js --store <path.json> query <text...> [--k N] [--exact] [--embedding tfidf|bow]

Flags may appear before or after the subcommand. Example:
  node dist/cli.js --store ./data/store.json query "cat mat" --k 3 --exact
`);
}

function stripFlags(items: string[]): {
    store?: string;
    k: number;
    exact: boolean;
    embedding: string;
    positional: string[];
} {
    const out = {
        k: 5,
        exact: false,
        embedding: "tfidf",
        positional: [] as string[],
    };
    let store: string | undefined;
    const q = [...items];
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i < q.length; i++) {
            const a = q[i];
            if (a === "--store" && q[i + 1]) {
                store = q[i + 1];
                q.splice(i, 2);
                changed = true;
                break;
            }
            if (a === "--k" && q[i + 1]) {
                out.k = Math.max(1, parseInt(q[i + 1], 10) || 5);
                q.splice(i, 2);
                changed = true;
                break;
            }
            if (a === "--exact") {
                out.exact = true;
                q.splice(i, 1);
                changed = true;
                break;
            }
            if (a === "--embedding" && q[i + 1]) {
                out.embedding = q[i + 1];
                q.splice(i, 2);
                changed = true;
                break;
            }
        }
    }
    return { store, ...out, positional: q };
}

function main(): void {
    const { store, k, exact, embedding, positional } = stripFlags(process.argv.slice(2));
    if (!store) {
        usage();
        process.exit(1);
    }
    const cmd = positional[0];
    const text = positional.slice(1).join(" ").trim();
    if (!cmd || (cmd !== "add" && cmd !== "query")) {
        usage();
        process.exit(1);
    }
    if (!text) {
        console.error("Missing text for", cmd);
        process.exit(1);
    }

    const emb = embedding === "bow" ? "bow" : "tfidf";
    const db = VectorDatabase.openOrCreate(store, emb as EmbeddingKind);

    if (cmd === "add") {
        const id = db.add(text);
        db.save(store);
        console.log(JSON.stringify({ ok: true, id, size: db.size }, null, 2));
        return;
    }

    const results = db.search(text, k, { exact });
    console.log(JSON.stringify({ ok: true, k, results }, null, 2));
}

main();
