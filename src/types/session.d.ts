import "express-session";

declare module "express-session" {
    interface SessionData {
        cas_user?: string;
    }
}
