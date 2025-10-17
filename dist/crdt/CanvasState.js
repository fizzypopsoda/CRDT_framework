"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CanvasState = void 0;
class CanvasState {
    constructor() {
        this.pixels = new Map();
    }
    makeKey(update) {
        return `${update.canvasId}:${update.x}:${update.y}`;
    }
    // Apply a new update, return true if it changed the state
    apply(update) {
        const key = this.makeKey(update);
        const existing = this.pixels.get(key);
        if (!existing ||
            update.ts > existing.ts ||
            (update.ts === existing.ts && update.opId > existing.opId)) {
            this.pixels.set(key, update);
            return true;
        }
        return false;
    }
    getPixel(canvasId, x, y) {
        return this.pixels.get(`${canvasId}:${x}:${y}`);
    }
    getAll() {
        return Array.from(this.pixels.values());
    }
    clear() {
        this.pixels.clear();
    }
}
exports.CanvasState = CanvasState;
