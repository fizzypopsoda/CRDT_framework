export interface PixelUpdate {
    canvasId: string;
    x: number;
    y: number;
    color: string;
    ts: number;     // timestamp
    userId: string;
    opId: string;   // unique operation ID
    college?: string;
}

export type PixelKey = string;