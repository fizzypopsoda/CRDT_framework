# Chaos Engineering (Milestone 4) – Chaos Mesh

We use **Chaos Mesh** on Minikube for pod-kill and network-delay experiments.

## How to test (quick flow)

1. **Prereqs:** Minikube running, app + analytics deployed (see `k8s/README.md`). From repo root.
2. **Install Chaos Mesh once** (see below). Wait until `kubectl get pods -n chaos-mesh` shows all Running.
3. **Experiment 1 – Pod kill:** Apply pod-kill, watch pods, then delete the experiment (see Experiment 1 below).
4. **Experiment 2 – Network delay:** Apply network-delay, use http://crdt.local or curl analytics, then delete the experiment (see Experiment 2 below).

---

## Install Chaos Mesh

```bash
helm repo add chaos-mesh https://charts.chaos-mesh.org
helm install chaos-mesh chaos-mesh/chaos-mesh --namespace=chaos-mesh --create-namespace --set chaosDaemon.runtime=containerd --set chaosDaemon.socketPath=/run/containerd/containerd.sock
```

On Minikube with Docker driver, use:

```bash
helm install chaos-mesh chaos-mesh/chaos-mesh --namespace=chaos-mesh --create-namespace
```

Wait until chaos-mesh pods are ready:

```bash
kubectl get pods -n chaos-mesh
```

## Deployment settings (recovery from pod kill)

Our app and analytics deployments rely on Kubernetes default behavior for recovery:

- **restartPolicy**: default `Always` – when a pod is killed, the controller restarts it.
- **replicas**: app has 2, analytics has 1 – so killing one app pod leaves 1 running while the other restarts.
- **livenessProbe**: both deployments have HTTP liveness probes so unhealthy pods are restarted.

No changes to deployment YAML are required for the pod-kill experiment; if a pod were not restarted, we would add or tighten `livenessProbe` and ensure `restartPolicy: Always` (default).

---

## Experiment 1: Pod kill test

**Goal:** Verify the system recovers when a pod unexpectedly crashes.

**Commands:**

```bash
kubectl get pods -l app=crdt-app
kubectl get pods -l app=analytics

kubectl apply -f k8s/chaos/pod-kill-experiment.yaml

kubectl get pods -l app=crdt-app -w

kubectl delete -f k8s/chaos/pod-kill-experiment.yaml
```

**Expected outcome:** Minikube (Kubernetes) automatically restarts the killed pod and replica count returns to 2. If not, deployment settings (e.g. livenessProbe, restartPolicy) should be adjusted.

---

## Experiment 2: Network latency test

**Goal:** Test if the system handles slow responses between services (app → analytics).

**Commands:**

```bash
kubectl apply -f k8s/chaos/network-delay-experiment.yaml
kubectl run curl --rm -it --restart=Never --image=curlimages/curl -- curl -w "%{time_total}\n" -o /dev/null -s http://analytics-service:3001/health

kubectl delete -f k8s/chaos/network-delay-experiment.yaml
```

**Expected outcome:** The app should still function with slower analytics calls (e.g. AUTH and pixel events may feel slightly delayed). If timeouts or errors appear, add retries or increase timeouts in the analytics client.
