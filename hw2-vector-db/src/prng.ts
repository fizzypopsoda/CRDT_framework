export function createRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(1664525, s) + 1013904223) >>> 0;
        return s / 0xffffffff;
    };
}

export function fillGaussian(rng: () => number, out: Float64Array): void {
    for (let i = 0; i < out.length; i++) {
        const u1 = rng() || 1e-12;
        const u2 = rng();
        out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
}
