"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAuth = setupAuth;
const express_session_1 = __importDefault(require("express-session"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const college_1 = require("./college");
const demoPersonas_1 = require("./demoPersonas");
function sessionSecret() {
    return process.env.SESSION_SECRET || "temporary-secret";
}
function isAssetPath(p) {
    return /\.(js|mjs|html|css|ico|png|svg|map|woff2?)$/i.test(p);
}
function setupAuth(app) {
    const CAS_BASE = "https://secure.its.yale.edu/cas";
    const SERVICE_URL = process.env.SERVICE_URL ||
        "https://crdt-framework.onrender.com/login";
    const AUTH_MODE = process.env.AUTH_MODE ?? "disabled";
    app.use((0, express_session_1.default)({
        secret: sessionSecret(),
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
        },
    }));
    if (AUTH_MODE === "disabled") {
        console.warn("⚠️  CAS auth disabled — assigning random demo Yale-style personas per session");
        app.use((_req, _res, next) => {
            if (!_req.session.demoPersonaAssigned) {
                const p = (0, demoPersonas_1.pickRandomDemoPersona)();
                _req.session.cas_user = p.netId;
                _req.session.college = p.college;
                _req.session.displayName = p.displayName;
                _req.session.demoPersonaAssigned = true;
            }
            next();
        });
    }
    app.get("/api/me", (req, res) => {
        const netId = req.session.cas_user;
        if (!netId) {
            return res.status(401).json({ error: "Not logged in" });
        }
        res.json({
            netId,
            college: req.session.college ?? (0, college_1.collegeFromNetId)(netId),
            displayName: req.session.displayName,
            authMode: AUTH_MODE,
            demoPersona: AUTH_MODE === "disabled",
        });
    });
    app.get("/api/ws-token", (req, res) => {
        const netId = req.session.cas_user;
        if (!netId) {
            return res.status(401).json({ error: "Not logged in" });
        }
        const college = req.session.college ?? (0, college_1.collegeFromNetId)(netId);
        const displayName = req.session.displayName;
        const token = jsonwebtoken_1.default.sign({ sub: netId, netId, college, displayName, v: 1 }, sessionSecret(), { expiresIn: "8h" });
        res.json({ token, netId, college, displayName });
    });
    if (AUTH_MODE === "disabled") {
        app.get("/login", (_req, res) => res.send("Auth disabled — you already have a demo persona. Open / ; use Log out to roll a new one."));
        app.get("/logout", (req, res) => {
            req.session.destroy(() => res.redirect("/"));
        });
        return;
    }
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
            req.session.college = (0, college_1.collegeFromNetId)(netid);
            req.session.displayName = undefined;
            req.session.demoPersonaAssigned = false;
            console.log("Logged in via Yale CAS:", netid, req.session.college);
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
        if (req.session.cas_user) {
            return next();
        }
        if (req.path.startsWith("/login") || req.path.startsWith("/logout")) {
            return next();
        }
        if (req.path.startsWith("/api/")) {
            return next();
        }
        if (isAssetPath(req.path)) {
            return next();
        }
        return res.redirect("/login");
    });
}
