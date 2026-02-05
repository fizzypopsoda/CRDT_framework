import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const TESTS_PATH = path.resolve(__dirname, '../../../tests.json');

interface Experiment {
    id: string;
    variants: string[];
    weights: number[];
    active: boolean;
}


export function getAssignedVariant(userId: string, experimentId: string): string | null {
    try {
        const data = JSON.parse(fs.readFileSync(TESTS_PATH, 'utf-8'));
        const experiment = data.experiments.find((e: Experiment) => e.id === experimentId);

        if (!experiment || !experiment.active) return null;

        const hash = crypto.createHash('md5').update(userId + experimentId).digest('hex');

        const bucket = parseInt(hash.substring(0, 8), 16) % 100;
        return bucket < 50 ? experiment.variants[0] : experiment.variants[1];
    } catch (err) {
        console.error("Error reading tests.json:", err);
        return null;
    }
}

export function logExposure(userId: string, experimentId: string, variant: string) {
    const timestamp = new Date().toISOString();
    console.log(`[AB_LOG_EXPOSURE] ${timestamp} | User: ${userId} | Test: ${experimentId} | Variant: ${variant}`);
}

export function logEvent(userId: string, eventName: string, variant: string) {
    const timestamp = new Date().toISOString();
    console.log(`[AB_LOG_EVENT] ${timestamp} | User: ${userId} | Event: ${eventName} | Variant: ${variant}`);
}