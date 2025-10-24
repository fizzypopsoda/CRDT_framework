"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAuth = setupAuth;
const express_session_1 = __importDefault(require("express-session"));
const node_fetch_1 = __importDefault(require("node-fetch"));
function setupAuth(app) {
    const CAS_BASE = "https://secure.its.yale.edu/cas";
    const SERVICE_URL = process.env.SERVICE_URL ||
        "https://crdt-framework.onrender.com/login";
    app.use((0, express_session_1.default)({
        secret: process.env.SESSION_SECRET || "replace-me",
        resave: false,
        saveUninitialized: true,
    }));
    app.get("/login", async (req, res) => {
        console.log("DEBUG /login hit:", req.method, req.url);
        const ticket = req.query.ticket;
        if (!ticket) {
            console.log("DEBUG no ticket → redirecting to CAS");
            const loginUrl = `${CAS_BASE}/login?service=${encodeURIComponent(SERVICE_URL)}`;
            return res.redirect(loginUrl);
        }
        console.log("DEBUG ticket received:", ticket);
        const validateUrl = `${CAS_BASE}/serviceValidate?ticket=${ticket}&service=${encodeURIComponent(SERVICE_URL)}`;
        try {
            const response = await (0, node_fetch_1.default)(validateUrl);
            const text = await response.text();
            const match = text.match(/<cas:user>(.*?)<\/cas:user>/);
            if (!match) {
                console.error("CAS validation failed:", text);
                return res.status(401).send("CAS validation failed");
            }
            const netid = match[1];
            req.session.cas_user = netid;
            console.log("Logged in via Yale CAS:", netid);
            return res.redirect("/");
        }
        catch (err) {
            console.error("CAS error:", err);
            return res.status(500).send("CAS authentication error");
        }
    });
    app.get("/logout", (req, res) => {
        req.session.destroy(() => {
            const logoutUrl = `${CAS_BASE}/logout?service=${encodeURIComponent(SERVICE_URL)}`;
            res.redirect(logoutUrl);
        });
    });
    app.use((req, res, next) => {
        if (!req.session.cas_user && !req.path.startsWith("/login")) {
            return res.redirect("/login");
        }
        next();
    });
}
