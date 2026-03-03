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

(Summary: Stress testing with k6 and Artillery; WebSocket and HTTP /api/health, /api/stats; async refactor of savePixel/clearCanvas; results and mitigations documented in prior revision.)

---

# Milestone 3 – Containers

## 1. Service-Oriented Architecture (Two Services)

The backend is split into two services:

1. **CRDT App (main application)** – WebSocket + HTTP server: canvas, auth, pixel/batch updates, Redis persistence, and `/api/health`, `/api/stats`. It calls the Analytics service over HTTP when `ANALYTICS_SERVICE_URL` is set.
2. **Analytics service** – Standalone HTTP API implementing the Milestone 1 A/B testing logic: variant assignment, exposure logging, event logging. Used as the second, well-defined service for the assignment.

## 2. Code Changes

- **`services/analytics/`** – New service:
  - `server.js`: Express app with `GET /health`, `GET /variant?userId=&experimentId=`, `POST /exposure`, `POST /event`. Same logic as `abTesting.ts` (MD5 bucketing, tests.json).
  - `package.json`, `Dockerfile`, `tests.json` (copy of root experiments config).
- **`src/server/analyticsClient.ts`** – New module: when `ANALYTICS_SERVICE_URL` is set, calls the Analytics service over HTTP; otherwise falls back to in-process `abTesting` so local dev works without the service.
- **`src/server/WebSocketServer.ts`** – Switched to `analyticsClient` (async `getAssignedVariant`, `logExposure`, `logEvent`). AUTH and pixel flows now await or call the client; behavior unchanged when Analytics is unavailable (fallback).
- **`Dockerfile`** (repo root) – Multi-stage build for the main app: build with Node, then production image running `node dist/server/WebSocketServer.js`.
- **`services/analytics/Dockerfile`** – Single-stage image for the Analytics service.
- **`.dockerignore`** – Excludes `node_modules`, `dist`, `.git`, etc., from build context.
- **`k8s/`** – Kubernetes manifests for Minikube:
  - `analytics-deployment.yaml`, `analytics-service.yaml`
  - `app-deployment.yaml`, `app-service.yaml` (env `ANALYTICS_SERVICE_URL=http://analytics-service:3001`)
  - `app-canary-deployment.yaml`, `app-canary-service.yaml` (canary app image)
  - `ingress.yaml`: main Ingress for app; canary Ingress with `nginx.ingress.kubernetes.io/canary: "true"` and `canary-weight: "20"` for 20% traffic to canary.
- **`k8s/README.md`** – Build, load, and deploy steps for Minikube.

## 3. Container Build and Orchestration

- **Containers:** Two images: `crdt-app` (main), `crdt-analytics` (Analytics). Built with Docker; for Minikube, images are built locally and loaded via `eval $(minikube docker-env)` then `docker build ...`.
- **Orchestration:** Kubernetes (Minikube). Deploy order: Analytics Deployment + Service, then App Deployment + Service, then Ingress. Canary: deploy canary Deployment + Service and apply canary Ingress so Nginx Ingress splits traffic (80% stable, 20% canary by weight).

## 4. Canary Releases

- **Mechanism:** Nginx Ingress canary annotations. Main Ingress backs `app-service` (stable). Second Ingress has `canary: "true"` and `canary-weight: "20"`, backing `app-canary-service`. Same host (`crdt.local`); Nginx sends ~20% of requests to the canary.
- **Usage:** Build canary image (e.g. `crdt-app:canary`), deploy `app-canary-deployment.yaml` and `app-canary-service.yaml`, apply canary Ingress. Adjust weight or remove canary Ingress to roll back.

## 5. How to Run

- **Local (no containers):** `AUTH_MODE=disabled npm run dev` (app uses in-process analytics). Optional: run Analytics service with `cd services/analytics && npm install && PORT=3001 node server.js`, then `ANALYTICS_SERVICE_URL=http://localhost:3001 npm run dev`.
- **Minikube:** See `k8s/README.md`. In short: `minikube start`, `minikube addons enable ingress`, build and load both images, `kubectl apply -f k8s/...`, add `crdt.local` to hosts pointing at `minikube ip`.

## 6. Challenges

- **Analytics service URL:** Main app must know the Analytics URL in Kubernetes. Set via env `ANALYTICS_SERVICE_URL=http://analytics-service:3001` in the app Deployment(s). No service discovery beyond K8s DNS.
- **Canary image:** Canary and stable use the same or different image tags (`crdt-app:latest` vs `crdt-app:canary`). For a real canary, build a new image with code changes and tag as `canary`; deploy canary Deployment with that image.