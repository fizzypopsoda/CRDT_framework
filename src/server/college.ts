export const RESIDENTIAL_COLLEGE_CODES = [
    "BF",
    "BK",
    "BR",
    "DC",
    "ES",
    "GH",
    "JE",
    "MC",
    "PM",
    "PS",
    "SY",
    "SM",
    "TD",
    "TR",
] as const;

export type ResidentialCollegeCode = (typeof RESIDENTIAL_COLLEGE_CODES)[number];

export function collegeFromNetId(netid: string): ResidentialCollegeCode | "Guest" {
    const n = (netid || "").trim().toLowerCase();
    if (!n || n === "guest") return "Guest";
    let h = 0;
    for (let i = 0; i < n.length; i++) {
        h = (h * 31 + n.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(h) % RESIDENTIAL_COLLEGE_CODES.length;
    return RESIDENTIAL_COLLEGE_CODES[idx]!;
}

export function collegeStripFromY(y: number, gridSize: number): number {
    const g = Math.max(1, gridSize);
    const clamped = Math.min(Math.max(y, 0), g - 1);
    const strip = Math.floor((clamped * RESIDENTIAL_COLLEGE_CODES.length) / g);
    return Math.min(strip, RESIDENTIAL_COLLEGE_CODES.length - 1);
}

export function collegeCodeAtPixel(_x: number, y: number, gridSize: number): ResidentialCollegeCode {
    return RESIDENTIAL_COLLEGE_CODES[collegeStripFromY(y, gridSize)]!;
}
