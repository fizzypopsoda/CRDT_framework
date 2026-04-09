# Homework 2 — Vector database

---

## Prerequisites

- **Node.js 18+**
- **npm** (ships with Node)

---

## Obtaining dependencies

Dependencies are declared in `package.json` and locked in `package-lock.json`. They are not included in a submission zip.

After unzipping, from this directory run:

```bash
npm install
```

That downloads TypeScript, Jest,ts-jest, and @types/ packages from the public npm registry. No separate downloads, API keys, or model files are required.

---

## Install, build, and test (local)

```bash
cd hw2-vector-db
npm install
npm run build
npm test
```

- `npm run build` compiles `src/*.ts` → `dist/` via `tsc`.
- `npm test` runs Jest tests in `tests/`.

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

