"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAssignedVariant = getAssignedVariant;
exports.logExposure = logExposure;
exports.logEvent = logEvent;
const abTesting_1 = require("./middleware/abTesting");
const BASE = process.env.ANALYTICS_SERVICE_URL || "";
const useRemote = BASE.length > 0;
async function fetchVariant(userId, experimentId) {
    if (!useRemote)
        return (0, abTesting_1.getAssignedVariant)(userId, experimentId);
    try {
        const url = `${BASE.replace(/\/$/, "")}/variant?userId=${encodeURIComponent(userId)}&experimentId=${encodeURIComponent(experimentId)}`;
        const res = await fetch(url);
        if (!res.ok)
            return (0, abTesting_1.getAssignedVariant)(userId, experimentId);
        const data = await res.json();
        return data.variant ?? null;
    }
    catch {
        return (0, abTesting_1.getAssignedVariant)(userId, experimentId);
    }
}
async function fetchExposure(userId, experimentId, variant) {
    if (!useRemote) {
        (0, abTesting_1.logExposure)(userId, experimentId, variant);
        return;
    }
    try {
        await fetch(`${BASE.replace(/\/$/, "")}/exposure`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, experimentId, variant }),
        });
    }
    catch {
        (0, abTesting_1.logExposure)(userId, experimentId, variant);
    }
}
async function fetchEvent(userId, eventName, variant) {
    if (!useRemote) {
        (0, abTesting_1.logEvent)(userId, eventName, variant);
        return;
    }
    try {
        await fetch(`${BASE.replace(/\/$/, "")}/event`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, eventName, variant }),
        });
    }
    catch {
        (0, abTesting_1.logEvent)(userId, eventName, variant);
    }
}
async function getAssignedVariant(userId, experimentId) {
    return fetchVariant(userId, experimentId);
}
async function logExposure(userId, experimentId, variant) {
    return fetchExposure(userId, experimentId, variant);
}
async function logEvent(userId, eventName, variant) {
    return fetchEvent(userId, eventName, variant);
}
