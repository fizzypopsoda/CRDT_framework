# Kubernetes (Minikube) deployment

## Prerequisites

- Docker
- Minikube: `minikube start`
- Nginx Ingress: `minikube addons enable ingress`

## Build and load images (Minikube uses local Docker)

```bash
# From repo root
eval $(minikube docker-env)
docker build -t crdt-app:latest .
docker build -t crdt-app:canary -f Dockerfile . 
docker build -t crdt-analytics:latest -f services/analytics/Dockerfile services/analytics
```

## Deploy

```bash
kubectl apply -f k8s/analytics-deployment.yaml -f k8s/analytics-service.yaml
kubectl apply -f k8s/app-deployment.yaml -f k8s/app-service.yaml
kubectl apply -f k8s/ingress.yaml
```

For canary: deploy canary app (optional, only if you want traffic split):

```bash
kubectl apply -f k8s/app-canary-deployment.yaml -f k8s/app-canary-service.yaml
```

The canary Ingress sends 20% of traffic to `app-canary-service` when both ingresses are applied.

## Access

Add to /etc/hosts (or use minikube ip):

```
<minikube ip> crdt.local
```

Then open http://crdt.local (or `minikube service ...` for NodePort).

To get minikube IP: `minikube ip`. With ingress: `minikube addons enable ingress` then visit http://crdt.local (ensure crdt.local resolves to minikube ip).
