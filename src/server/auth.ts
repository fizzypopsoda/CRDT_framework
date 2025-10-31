import express from "express";
import session from "express-session";
import fetch from "node-fetch";

export function setupAuth(app: express.Application) {
    const CAS_BASE = "https://secure.its.yale.edu/cas";
    const SERVICE_URL =
        process.env.SERVICE_URL ||
        "https://crdt-framework.onrender.com/login";

    app.use(
        session({
            secret: process.env.SESSION_SECRET as string,
            resave: false,
            saveUninitialized: true,
        })
    );

    app.get("/login", async (req, res) => {
        console.log("DEBUG /login hit:", req.method, req.url);
        const ticket = req.query.ticket as string | undefined;

        if (!ticket) {
            console.log("DEBUG no ticket → redirecting to CAS");
            const loginUrl = `${CAS_BASE}/login?service=${encodeURIComponent(
                SERVICE_URL
            )}`;
            return res.redirect(loginUrl);
        }

        console.log("DEBUG ticket received:", ticket);
        const validateUrl = `${CAS_BASE}/serviceValidate?ticket=${ticket}&service=${encodeURIComponent(
            SERVICE_URL
        )}`;

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
            console.log("Logged in via Yale CAS:", netid);

            return res.redirect("/");
        } catch (err) {
            console.error("CAS error:", err);
            return res.status(500).send("CAS authentication error");
        }
    });

    app.get("/logout", (req, res) => {
        req.session.destroy(() => {
            const logoutUrl = `${CAS_BASE}/logout?service=${encodeURIComponent(
                SERVICE_URL
            )}`;
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

