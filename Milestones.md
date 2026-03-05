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
