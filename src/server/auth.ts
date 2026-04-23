import express from "express";
import session from "express-session";
import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import { collegeFromNetId } from "./college";
import { pickRandomDemoPersona } from "./demoPersonas";

declare module "express-session" {
    interface SessionData {
        cas_user?: string;
        college?: string;
        displayName?: string;
        demoPersonaAssigned?: boolean;
    }
}

function sessionSecret(): string {
    return process.env.SESSION_SECRET || "temporary-secret";
}

function isAssetPath(p: string): boolean {
    return /\.(js|mjs|html|css|ico|png|svg|map|woff2?)$/i.test(p);
}

export function setupAuth(app: express.Application) {
    const CAS_BASE = "https://secure.its.yale.edu/cas";
    const SERVICE_URL =
        process.env.SERVICE_URL ||
        "https://crdt-framework.onrender.com/login";
    const AUTH_MODE = process.env.AUTH_MODE ?? "disabled";

    app.use(
        session({
            secret: sessionSecret(),
            resave: false,
            saveUninitialized: true,
            cookie: {
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
            },
        })
    );

    if (AUTH_MODE === "disabled") {
        console.warn("⚠️  CAS auth disabled — assigning random demo Yale-style personas per session");

        app.use((_req, _res, next) => {
            if (!_req.session.demoPersonaAssigned) {
                const p = pickRandomDemoPersona();
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
            college: req.session.college ?? collegeFromNetId(netId),
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
        const college = req.session.college ?? collegeFromNetId(netId);
        const displayName = req.session.displayName;
        const token = jwt.sign(
            { sub: netId, netId, college, displayName, v: 1 },
            sessionSecret(),
            { expiresIn: "8h" }
        );
        res.json({ token, netId, college, displayName });
    });

    if (AUTH_MODE === "disabled") {
        app.get("/login", (_req, res) =>
            res.send("Auth disabled — you already have a demo persona. Open / ; use Log out to roll a new one.")
        );
        app.get("/logout", (req, res) => {
            req.session.destroy(() => res.redirect("/"));
        });
        return;
    }

    app.get("/login", async (req, res) => {
        console.log("DEBUG /login hit:", req.method, req.url);
        const ticket = req.query.ticket as string | undefined;

        if (!ticket) {
            console.log("DEBUG no ticket → redirecting to CAS");
            const loginUrl = `${CAS_BASE}/login?service=${encodeURIComponent(SERVICE_URL)}`;
            return res.redirect(loginUrl);
        }

        console.log("DEBUG ticket received:", ticket);
        const validateUrl = `${CAS_BASE}/serviceValidate?ticket=${ticket}&service=${encodeURIComponent(SERVICE_URL)}`;

        try {
            const response = await fetch(validateUrl);
            const text = await response.text();

            const match = text.match(/<cas:user>(.*?)<\/cas:user>/);
            if (!match) {
                console.error("CAS validation failed:", text);
                return res.status(401).send("CAS validation failed");
            }

            const netid = match[1];
            req.session.cas_user = netid;
            req.session.college = collegeFromNetId(netid) as string;
            req.session.displayName = undefined;
            req.session.demoPersonaAssigned = false;
            console.log("Logged in via Yale CAS:", netid, req.session.college);
            return res.redirect("/");
        } catch (err) {
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
