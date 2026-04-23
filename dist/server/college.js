"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESIDENTIAL_COLLEGE_CODES = void 0;
exports.collegeFromNetId = collegeFromNetId;
exports.collegeStripFromY = collegeStripFromY;
exports.collegeCodeAtPixel = collegeCodeAtPixel;
exports.RESIDENTIAL_COLLEGE_CODES = [
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
];
function collegeFromNetId(netid) {
    const n = (netid || "").trim().toLowerCase();
    if (!n || n === "guest")
        return "Guest";
    let h = 0;
    for (let i = 0; i < n.length; i++) {
        h = (h * 31 + n.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(h) % exports.RESIDENTIAL_COLLEGE_CODES.length;
    return exports.RESIDENTIAL_COLLEGE_CODES[idx];
}
function collegeStripFromY(y, gridSize) {
    const g = Math.max(1, gridSize);
    const clamped = Math.min(Math.max(y, 0), g - 1);
    const strip = Math.floor((clamped * exports.RESIDENTIAL_COLLEGE_CODES.length) / g);
    return Math.min(strip, exports.RESIDENTIAL_COLLEGE_CODES.length - 1);
}
function collegeCodeAtPixel(_x, y, gridSize) {
    return exports.RESIDENTIAL_COLLEGE_CODES[collegeStripFromY(y, gridSize)];
}
