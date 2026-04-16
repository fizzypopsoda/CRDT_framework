# Milestone 1

## 1. Implementation Overview
I have successfully implemented a deterministic A/B testing infrastructure within the CRDT framework. This system allows for persistent user bucketing and server-side tracking of user behavior without interfering with the core CRDT logic.

### Core Components:
* tests.json: A central configuration file located in the root directory that defines active experiments, their variants, and traffic weights.
* abTesting.ts Middleware:
    * Assignment: Uses a stable MD5 hashing algorithm combining the userId and experimentId to ensure "sticky" variant assignment (the user sees the same variant every time they return).
    * Exposure Logging: Captures a log entry when a user first connects and is assigned to a test group.
    * Event Logging: Captures a log entry every time a user successfully performs a "target action"-in this case, placing a pixel via the CRDT.

## 2. Technical Challenges & Solutions
I had a few small challenges.
- Adding a custom cas_user property to the Express session caused TS2339 errors because the property was not defined 
in the standard express-session types.
Solution: I implemented Declaration Merging by using `declare module "express-session"` to extend the SessionData
interface.
CAS Authorization in Local Development
Challenge: Yale CAS authentication restricts service redirects to registered domains, thus preventing local testing on 
localhost.
Solution: I implemented an AUTH_MODE toggle. By setting AUTH_MODE=disabled, I created a development bypass that 
- simulates a logged-in user with a persistent ID, allowing me to verify the A/B testing logic locally without 
requiring Yale's live CAS servers.

## 3. Verification of Results
The infrastructure was verified by monitoring the server-side logs during active sessions.
* Exposure Log: [AB_LOG_EXPOSURE] | User: anon-0ghj66 | Test: pixel_size_test | Variant: large - Confirmed the user was 
successfully bucketed.
* Conversion Log: [AB_LOG_EVENT] | User: anon-0ghj66 | Event: pixel_placed | Variant: large - Confirmed that actions 
are correctly attributed to the assigned variant across multiple interactions.

---

# Milestone 2 – Concurrency

## 1. Implementation overview

- **Stress testing:** k6 scripts in `tests/` exercise WebSocket connections and pixel updates ( `tests/loadtest.js` with staged load). 
- **HTTP endpoints for load tests:** `GET /api/health` and `GET /api/stats` are implemented in `src/server/WebSocketServer.ts` so load tools can hit a simple HTTP API.
- **Async refactor:** `savePixel()` and `clearCanvas()` in `WebSocketServer.ts` are async and run without blocking the WebSocket loop (fire-and-forget or awaited where ordering matters), so concurrent pixel updates and clears are handled safely.

## 2. Where to find it

k6 WebSocket load test -> `tests/loadtest.js` 
Run multiple k6 runs / average results -> `tests/run_multiple.js`, `tests/average_results.js` 
HTTP /api/health, /api/stats -> `src/server/WebSocketServer.ts` (Express routes)
savePixel / clearCanvas (async) -> `src/server/WebSocketServer.ts`

## 3. Commands

```bash
npm run loadtest
# or: npm run loadtest:concurrent
```

Start the server  (`npm run dev`) before running load tests

---

# Milestone 3 – Containers

## 1. Service-Oriented Architecture (Two Services)

The backend is split into two services:

1. **CRDT App (main application)** – WebSocket + HTTP server: canvas, auth, pixel/batch updates, Redis persistence, and `/api/health`, `/api/stats`. It calls the Analytics service over HTTP when `ANALYTICS_SERVICE_URL` is set.
2. **Analytics service** – Standalone HTTP API implementing the Milestone 1 A/B testing logic: variant assignment, exposure logging, event logging.


## 2. Container Build and Orchestration

- **Containers:** Two images: `crdt-app` (main), `crdt-analytics` (Analytics). Built with Docker; for Minikube, images are built locally and loaded via `eval $(minikube docker-env)` then `docker build ...`.
- **Orchestration:** Kubernetes (Minikube). Deploy order: Analytics Deployment + Service, then App Deployment + Service, then Ingress. Canary: deploy canary Deployment + Service and apply canary Ingress so Nginx Ingress splits traffic (80% stable, 20% canary by weight).

## 3. Canary Releases

- **Mechanism:** Nginx Ingress canary annotations. Main Ingress backs `app-service` (stable). Second Ingress has `canary: "true"` and `canary-weight: "20"`, backing `app-canary-service`. Same host (`crdt.local`); Nginx sends ~20% of requests to the canary.
- **Usage:** Build canary image (e.g. `crdt-app:canary`), deploy `app-canary-deployment.yaml` and `app-canary-service.yaml`, apply canary Ingress. Adjust weight or remove canary Ingress to roll back.

## 4. How to Run

- **Local (no containers):** `AUTH_MODE=disabled npm run dev` (app uses in-process analytics). Optional: run Analytics service with `cd services/analytics && npm install && PORT=3001 node server.js`, then `ANALYTICS_SERVICE_URL=http://localhost:3001 npm run dev`.
- **Minikube:** See `k8s/README.md`. In short: `minikube start`, `minikube addons enable ingress`, build and load both images, `kubectl apply -f k8s/...`, add `crdt.local` to hosts pointing at `minikube ip`.

---

# Milestone 4 - Chaos Engineering

We use **Chaos Mesh** on Minikube for two experiments: pod kill (recovery from unexpected failures) and network latency (slow connections between app and analytics).

## 1. Deployment configuration (recovery from failures)

Deployment files used for these experiments (and for normal runs) are in `k8s/`:

- **`k8s/app-deployment.yaml`** – Main app: `replicas: 2`, `livenessProbe` on `/api/health`, default `restartPolicy: Always`. When a pod is killed, the Deployment controller starts a new pod so the system recovers.
- **`k8s/analytics-deployment.yaml`** – Analytics: `replicas: 1`, `livenessProbe` on `/health`, default `restartPolicy: Always`. Same recovery behavior.

No deployment changes were required for the pod-kill experiment; if a pod had not been restarted, we would add or tighten `livenessProbe` and ensure `restartPolicy: Always` explicitly.

## 2. Chaos framework and experiment configs

- **Framework:** Chaos Mesh (https://chaos-mesh.org), installed via Helm in the `chaos-mesh` namespace.
- **Experiment manifests:** `k8s/chaos/pod-kill-experiment.yaml`, `k8s/chaos/network-delay-experiment.yaml`. Full install and run instructions: `k8s/chaos/README.md`.

**Experiment 1 – Pod kill:** `PodChaos` with `action: pod-kill`, `mode: one`, selector `app: crdt-app`. It kills one main-app pod so we can verify Kubernetes restarts it.

**Experiment 2 – Network latency:** `NetworkChaos` with `action: delay`, `latency: "500ms"`, selector `app: analytics`, `duration: "5m"`. Injects 500ms delay to traffic involving the analytics pods so app → analytics calls are slow.

## 3. Commands executed

**Install Chaos Mesh (once):**

```bash
helm repo add chaos-mesh https://charts.chaos-mesh.org
helm install chaos-mesh chaos-mesh/chaos-mesh --namespace=chaos-mesh --create-namespace
kubectl get pods -n chaos-mesh
```

**Experiment 1 – Pod kill:**

```bash
kubectl get pods -l app=crdt-app
kubectl apply -f k8s/chaos/pod-kill-experiment.yaml
kubectl get pods -l app=crdt-app -w
kubectl delete -f k8s/chaos/pod-kill-experiment.yaml
```

**Experiment 2 – Network latency:**

```bash
kubectl apply -f k8s/chaos/network-delay-experiment.yaml
# Use the app (e.g. http://crdt.local); analytics calls will be delayed ~500ms
kubectl delete -f k8s/chaos/network-delay-experiment.yaml
```

## 4. Findings

- **Pod kill:** Kubernetes restarts the killed `crdt-app` pod automatically (we observed a canary pod killed and a new one created). Replica count is restored. No deployment changes were needed.
- **Network latency:** With 500ms delay on analytics, the app still functions. Measured with `curl` from inside the cluster to `http://analytics-service:3001/health`: **~1.5s** with the experiment active vs **~0.01s** without. A/B and event calls to analytics are slower but no timeouts or errors

- Testing PR summary capability.... added this line to readme


Milestone 5:

Output from Aider:
"Okay, let's see. The user provided a git diff and a request to summarize a PR. They want me to look at the changes in   
the diff and figure out what's going on.                                                                                

First, the deleted .DS_Store files. Those are macOS temporary files, so removing them is standard. The new .gitignore   
entry for .DS_Store makes sense to prevent them from being tracked in the future. That's good repo hygiene.             

Then there's the hw2-vector-db.zip added as a binary. Since it's a zip file, I can't see the contents here. The user    
might need to check if this zip is necessary or if it's a large file that should be ignored. But the .gitignore already 
has .DS_Store, so maybe the zip is intentional.                                                                         

In Milestones.md, a line was added about testing PR summary capability. The rest of the file seems to have some         
Kubernetes-related notes. The user added a line at the end, but there's a "No newline at end of file" warning. That's a 
minor issue, but fixing it would be good practice.                                                                      

The PR summary mentions checking for intent, repo hygiene, binary diffs, and things to verify. The user wants a summary 
of these aspects. The binary diffs (like the zip and .DS_Store) don't show content changes, so they might be harmless   
but need checking. The .gitignore addition is positive. The Milestones.md edit is minor but could be a placeholder for  
future notes.                                                                                                           

I need to make sure I don't suggest any changes unless the user asks. The user's main request is to summarize the PR    
based on the diff. So I should outline the intent (adding the zip, cleaning up .DS_Store), repo hygiene (new .gitignore 
entry, zip file), what the binary diffs hide (can't see contents of zip), and what to verify manually (like the zip's   
necessity and the Milestones line's purpose).                                                                           


 1 Intent:                                                                                                              
    • The PR adds a binary zip file (hw2-vector-db.zip) and cleans up .DS_Store files (macOS metadata).                 
    • A new line was added to Milestones.md for testing PR summary capability.                                          
    • A .gitignore file was created to exclude .DS_Store files.                                                         
 2 Repo Hygiene / Risks:                                                                                                
    • ✅ .DS_Store files are removed, and .gitignore now blocks future tracking of these files.                         
    • ⚠️ hw2-vector-db.zip is a binary blob. Large binary files in repos can bloat the history and are generally        
      discouraged unless necessary. Verify if this zip is required or if it should be replaced with a source folder     
      (e.g., hw2-vector-db/) and added to .gitignore.                                                                   
    • ⚠️ The line +Testing PR summary capability.... added this line to readme in Milestones.md appears to be a         
      placeholder/test. Confirm if this is intentional or a draft note.                                                 
 3 What Binary Diffs Hide:                                                                                              
    • The hw2-vector-db.zip binary diff does not show its contents. Verify:                                             
       • Is this zip file necessary for the project?                                                                    
       • Does it contain source code, assets, or something else?                                                        
       • Should it be replaced with source files and tracked via version control (if applicable)?                       
 4 What to Verify Manually:                                                                                             
    • Confirm the purpose of the hw2-vector-db.zip file.                                                                
    • Check if the .DS_Store files were removed from all relevant directories.                                          
    • Validate that the .gitignore entry for .DS_Store is sufficient for the project's needs.                           
    • Review the added line in Milestones.md to ensure it aligns with the project's documentation goals.                

No files need immediate changes unless further clarification is provided."

I would say it made the reviewing process easier and it covered crucial changes.

Feedback on Aider:

We used Aider CLI from the project root with `groq/qwen/qwen3-32b`, `GROQ_API_KEY` exported in the same terminal, and `--map-tokens 0` after hitting Groq TPM errors on larger maps.

Task: Add module-level `lastWsMessageAt`, set it on each WebSocket message, add `GET /api/ping` returning `{ ok, ts, lastWsMessageAt }`, without removing existing `wss.on("connection")` or `switch (data.type)` cases.

What worked: The model’s step-by-step plan matched the intended design (where to put the variable, when to update the timestamp, where to register the route).

What did not:
Groq often rate-limited when the combined context was still too large. 
Replies repeatedly hit an output token cap (2k), so diffs were truncated. Even with an explicit “additive only” instruction, the emitted diff removed the entire WebSocket message handler and replaced it with `/api/ping`-that patch would have broken the app, so I did not apply it and confirmed with `git diff` / `npm run build`.

I added `GET /api/ping` myself; `lastWsMessageAt` and the per-message update were already present in `WebSocketServer.ts` after earlier edits.

Aider is useful for structuring a change, but with Groq + default output limits it was unreliable for large files: truncated outputs and unsafe hunks required careful review. For this project I would split work into smaller files/prompts or use a higher output limit / different model if available..

# Playwright and LLM browser helper

## 1. What this adds

Playwright runs a couple of smoke checks against the real pixel canvas (page loads, canvas and mode toggle visible, `/api/health` returns JSON). Separately, a small Node script opens the site in Chromium, sends a short text snapshot of the page to Groq, gets back a JSON plan (click, wait, goto same-origin, or done), runs that plan in a loop, then asks the model for a one-line summary.

The E2E config starts its own dev server on port 4173 with `AUTH_MODE=disabled` so tests do not attach to whatever I might already have on 8080 with CAS on—that was producing a useless browser title of "Error" because `/` never reached our HTML. To reuse an existing server, set `PLAYWRIGHT_REUSE_SERVER=1` and point `PLAYWRIGHT_BASE_URL` / `PLAYWRIGHT_PORT` at it.

- `playwright.config.js` — base URL, webServer wait on `/api/health`, Chromium project.
- `tests/e2e/canvas-smoke.spec.js` — Playwright specs only (Jest stays in `tests/*.test.ts`).
- `scripts/llm-browser-assistant.mjs` — browser loop; reuses `scripts/llm-providers.mjs`.
- `package.json` — `test:e2e`, `test:e2e:install`, `test:e2e:ci`, `llm-assistant`.
- `.gitignore` — playwright-report, test-results, blob-report.

First time on a machine: `npm run test:e2e:install` (or `npx playwright install`)

## 3. Commands

```bash
npm run test:e2e:install
npm run test:e2e
npm run test:e2e:ci

export GROQ_API_KEY=...
npm run llm-assistant -- 'click #modeToggle once then stop'
```

If the app is only on 4173, export `LLM_ASSISTANT_BASE_URL=http://127.0.0.1:4173` before `npm run llm-assistant`.

## 4. Findings

The model sometimes returns invalid JSON or a selector that is not on the page; the script logs it and continues, and bad clicks do not kill the run. Groq TPM behaves like it did with Aider—short goals and a low `LLM_ASSISTANT_STEPS` help. We also fixed static paths for `tsx` dev (`../public` from `src/server`) so `test-client.html` is found; before that, `sendFile` hit ENOENT and the UI test saw an error page.

---

# Milestone 6

## 1. GenAI feature and three approaches

The feature is a small question-answering path over Groq, exposed as HTTP APIs so we can compare outputs. There are n = 3 fixed approaches, each with its own model and/or temperature and/or system prompt:

- strict-qwen— `qwen/qwen3-32b`, low temperature, system text pushes short factual answers.
- creative-qwen — same model, higher temperature, looser system text for more variety.
- fast-llama — `llama-3.1-8b-instant`, mid temperature, system text forces very short replies.

Code is in `src/server/genaiEval.ts` (routes registered from `WebSocketServer.ts`). We did not add LangChain; the three approaches are plain parameter sets plus `fetch` to Groq’s chat API, which keeps the stack small. The same file could be wrapped with LangChain chains later if we want templating and tracing.

## 2. API behavior

- `POST /api/genai` with JSON `{ "prompt": "..." }` returns one completion. Optional `"approach": "strict-qwen" | "creative-qwen" | "fast-llama"`; if omitted, the server round-robins a default among the three.
- Same path with query `?dual=1` (or `dual=true`, or body `"dual": true`) returns two completions from two different approaches (rotates among three fixed pairs so comparisons vary).
- `POST /api/genai/preference` with `{ "winner": "<approachId>", "loser": "<approachId>" }` does the same as sending `{ "preference": { "winner", "loser" } }` on `POST /api/genai` (single-endpoint variant for graders who want one URL).
- `GET /api/genai/elo` returns current ELO-style ratings and a sorted ranking list.
- `GET /api/genai/approaches` lists ids and metadata for clients.

`express.json()` is enabled on the app before these routes (same server as the canvas).

## 3. ELO scoring

Each approach keeps a numeric rating (starts at 1500). On each preference, we apply the usual expected-score formula `E = 1 / (1 + 10^((R_opponent - R_self)/400))` and update `R' = R + K * (S - E)` with `K = 32`, `S=1` for the winner and `S=0` for the loser. Code is in `EloTracker` in `genaiEval.ts`;
tests in `tests/genaiElo.test.ts` check symmetry, ordering intuition, and monotonicity after one update.

Ratings are in-memory only (reset on server restart). Redis persistence would be an obvious next step. jest.config.js now ignores `tests/e2e/` so Playwright specs are not picked up by Jest.

## 4. How to try it

Needs `GROQ_API_KEY` (same as other Groq scripts). Server: `AUTH_MODE=disabled npm run dev`.

```bash
curl -s http://127.0.0.1:8080/api/genai/approaches | jq .

curl -s -X POST http://127.0.0.1:8080/api/genai \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What is a CRDT in one sentence?"}' | jq .

curl -s -X POST "http://127.0.0.1:8080/api/genai?dual=1" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Name one benefit of WebSockets for a shared canvas."}' | jq .

curl -s -X POST http://127.0.0.1:8080/api/genai/preference \
  -H "Content-Type: application/json" \
  -d '{"winner":"strict-qwen","loser":"fast-llama"}' | jq .

curl -s http://127.0.0.1:8080/api/genai/elo | jq .
```

## 5. Findings / challenges

- Groq limits: Dual mode fires two model calls at once; under heavy TPM limits we may need to lower `max_tokens`.
- No LangChain: Faster to ship and easier to read... tradeoff is no built-in prompt versioning—approaches are constants in one file.

