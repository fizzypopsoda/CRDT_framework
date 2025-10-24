"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAuth = setupAuth;
const express_session_1 = __importDefault(require("express-session"));
const node_cas_client_1 = require("node-cas-client");
function setupAuth(app) {
    app.use((0, express_session_1.default)({
        secret: process.env.SESSION_SECRET || "replace-me",
        resave: false,
        saveUninitialized: true,
    }));
    const cas = new node_cas_client_1.CASClient({
        cas_url: "https://secure.its.yale.edu/cas",
        service_url: process.env.SERVICE_URL || "https://crdt-framework.onrender.com/login",
        cas_version: "3.0",
    });
    app.get("/login", async (req, res) => {
        try {
            const ticket = req.query.ticket;
            if (!ticket) {
                const loginUrl = await cas.login();
                return res.redirect(loginUrl);
            }
            else {
                const profile = await cas.validate(ticket);
                req.session.user = profile.user;
                console.log("✅ Authenticated via Yale CAS:", profile.user);
                res.redirect("/");
            }
        }
        catch (err) {
            console.error("CAS login failed:", err);
            res.status(500).send("CAS authentication failed.");
        }
    });
    app.get("/logout", (req, res) => {
        req.session.destroy(() => {
            const logoutUrl = "https://secure.its.yale.edu/cas/logout";
            res.redirect(logoutUrl);
        });
    });
    app.use((req, res, next) => {
        if (req.path.startsWith("/login") || req.path.startsWith("/logout"))
            return next();
        if (!req.session.user)
            return res.redirect("/login");
        next();
    });
}
