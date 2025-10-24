import express from "express";
import session from "express-session";
import { CASClient } from "node-cas-client";

export function setupAuth(app: express.Application) {
    app.use(
        session({
            secret: process.env.SESSION_SECRET || "replace-me",
            resave: false,
            saveUninitialized: true,
        })
    );

    const cas = new CASClient({
        cas_url: "https://secure.its.yale.edu/cas",
        service_url: process.env.SERVICE_URL || "https://crdt-framework.onrender.com/login",
        cas_version: "3.0",
    });

    app.get("/login", async (req, res) => {
        try {
            const ticket = req.query.ticket as string;
            if (!ticket) {
                const loginUrl = await cas.login();
                return res.redirect(loginUrl);
            } else {
                const profile = await cas.validate(ticket);
                req.session.user = profile.user;
                console.log("✅ Authenticated via Yale CAS:", profile.user);
                res.redirect("/");
            }
        } catch (err) {
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
        if (req.path.startsWith("/login") || req.path.startsWith("/logout")) return next();
        if (!req.session.user) return res.redirect("/login");
        next();
    });
}
