declare module "connect-cas" {
    import { RequestHandler } from "express";

    export interface ConnectCasOptions {
        cas_url: string;
        servicePrefix: string;
        serverPath: string;
        cas_version?: string;
    }

    export interface ConnectCasInstance {
        bounce: RequestHandler;
        block: RequestHandler;
        logout: RequestHandler;
    }

    export default function createCASClient(
        options: ConnectCasOptions
    ): ConnectCasInstance;
}