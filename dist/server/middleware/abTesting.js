"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAssignedVariant = getAssignedVariant;
exports.logExposure = logExposure;
exports.logEvent = logEvent;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const TESTS_PATH = path_1.default.resolve(__dirname, '../../../tests.json');
function getAssignedVariant(userId, experimentId) {
    try {
        const data = JSON.parse(fs_1.default.readFileSync(TESTS_PATH, 'utf-8'));
        const experiment = data.experiments.find((e) => e.id === experimentId);
        if (!experiment || !experiment.active)
            return null;
        const hash = crypto_1.default.createHash('md5').update(userId + experimentId).digest('hex');
        const bucket = parseInt(hash.substring(0, 8), 16) % 100;
        return bucket < 50 ? experiment.variants[0] : experiment.variants[1];
    }
    catch (err) {
        console.error("Error reading tests.json:", err);
        return null;
    }
}
function logExposure(userId, experimentId, variant) {
    const timestamp = new Date().toISOString();
    console.log(`[AB_LOG_EXPOSURE] ${timestamp} | User: ${userId} | Test: ${experimentId} | Variant: ${variant}`);
}
function logEvent(userId, eventName, variant) {
    const timestamp = new Date().toISOString();
    console.log(`[AB_LOG_EVENT] ${timestamp} | User: ${userId} | Event: ${eventName} | Variant: ${variant}`);
}
