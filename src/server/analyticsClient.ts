import { getAssignedVariant as localVariant, logExposure as localExposure, logEvent as localEvent } from "./middleware/abTesting";

const BASE = process.env.ANALYTICS_SERVICE_URL || "";
const useRemote = BASE.length > 0;

async function fetchVariant(userId: string, experimentId: string): Promise<string | null> {
  if (!useRemote) return localVariant(userId, experimentId);
  try {
    const url = `${BASE.replace(/\/$/, "")}/variant?userId=${encodeURIComponent(userId)}&experimentId=${encodeURIComponent(experimentId)}`;
    const res = await fetch(url);
    if (!res.ok) return localVariant(userId, experimentId);
    const data = await res.json();
    return data.variant ?? null;
  } catch {
    return localVariant(userId, experimentId);
  }
}

async function fetchExposure(userId: string, experimentId: string, variant: string): Promise<void> {
  if (!useRemote) {
    localExposure(userId, experimentId, variant);
    return;
  }
  try {
    await fetch(`${BASE.replace(/\/$/, "")}/exposure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, experimentId, variant }),
    });
  } catch {
    localExposure(userId, experimentId, variant);
  }
}

async function fetchEvent(userId: string, eventName: string, variant: string): Promise<void> {
  if (!useRemote) {
    localEvent(userId, eventName, variant);
    return;
  }
  try {
    await fetch(`${BASE.replace(/\/$/, "")}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, eventName, variant }),
    });
  } catch {
    localEvent(userId, eventName, variant);
  }
}

export async function getAssignedVariant(userId: string, experimentId: string): Promise<string | null> {
  return fetchVariant(userId, experimentId);
}

export async function logExposure(userId: string, experimentId: string, variant: string): Promise<void> {
  return fetchExposure(userId, experimentId, variant);
}

export async function logEvent(userId: string, eventName: string, variant: string): Promise<void> {
  return fetchEvent(userId, eventName, variant);
}
