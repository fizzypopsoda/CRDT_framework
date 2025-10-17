// @ts-ignore
import { CanvasState } from "../src/crdt/CanvasState";
import type {PixelUpdate} from "../src/crdt/types";

test("later timestamp overwrites earlier", () => {
    const cs = new CanvasState();

    const p1: PixelUpdate = {
        canvasId: "c1",
        x: 1, y: 1,
        color: "#FF0000",
        ts: 1,
        userId: "u1",
        opId: "op1"
    };

    const p2: PixelUpdate = {
        ...p1,
        color: "#0000FF",
        ts: 2,
        opId: "op2"
    };

    cs.apply(p1);
    expect(cs.getPixel("c1", 1, 1)?.color).toBe("#FF0000");

    cs.apply(p2);
    expect(cs.getPixel("c1", 1, 1)?.color).toBe("#0000FF");
});

test("ties broken by opId", () => {
    const cs = new CanvasState();

    const p1: PixelUpdate = {
        canvasId: "c1",
        x: 1, y: 1,
        color: "#FF0000",
        ts: 1,
        userId: "u1",
        opId: "opA"
    };

    const p2: PixelUpdate = {
        ...p1,
        color: "#00FF00",
        opId: "opB" // later opId wins if ts equal
    };

    cs.apply(p1);
    cs.apply(p2);

    expect(cs.getPixel("c1", 1, 1)?.color).toBe("#00FF00");
});