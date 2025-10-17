import { PixelUpdate, PixelKey } from "./types";

export class CanvasState {
    private pixels: Map<PixelKey, PixelUpdate> = new Map();

    private makeKey(update: PixelUpdate): PixelKey {
        return `${update.canvasId}:${update.x}:${update.y}`;
    }

    // Apply a new update, return true if it changed the state
    apply(update: PixelUpdate): boolean {
        const key = this.makeKey(update);
        const existing = this.pixels.get(key);

        if (
            !existing ||
            update.ts > existing.ts ||
            (update.ts === existing.ts && update.opId > existing.opId)
        ) {
            this.pixels.set(key, update);
            return true;
        }

        return false;
    }

    getPixel(canvasId: string, x: number, y: number): PixelUpdate | undefined {
        return this.pixels.get(`${canvasId}:${x}:${y}`);
    }

    getAll(): PixelUpdate[] {
        return Array.from(this.pixels.values());
    }
    clear(): void {
        this.pixels.clear();
    }
}