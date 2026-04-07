# Homework Assignment 2 — Vector database

---

**Commands:**

1. **Add** — encode and store a piece of text.  
2. **Query** — return the k most similar stored texts for a query string.

---

## Prerequisites

- **Node.js 18+**
- **npm** 

---

## Install and build

```bash
cd hw2-vector-db
npm install
npm run build
npm test
```

---

## CLI usage

```bash
node dist/cli.js --store ./data/store.json add "The quick brown fox jumps over the lazy dog"
node dist/cli.js --store ./data/store.json add "Machine learning models need training data"
node dist/cli.js --store ./data/store.json add "Cooking soup with vegetables"

node dist/cli.js --store ./data/store.json query "training neural models" --k 2

node dist/cli.js --store ./data/store.json query "fox and dog" --k 2 --exact

node dist/cli.js --store ./data/bow.json add "word one two"
node dist/cli.js --store ./data/bow.json query "one two" --k 1 --embedding bow
```

Output is JSON: `add` returns `{ ok, id, size }`; `query` returns `{ ok, k, results: [{ id, text, score, approximate }] }`.

