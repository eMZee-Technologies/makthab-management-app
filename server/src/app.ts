import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import path from "node:path";
import fs from "node:fs";
import { env, isProd } from "./lib/env";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { apiRouter } from "./routes";

// Express app factory. Kept side-effect free so tests can create isolated apps.
export function createApp(): Express {
  const app = express();

  app.use(
    cors({
      origin: env.clientOrigin,
      credentials: true,
      // Without this, Content-Disposition is invisible to browser JS on
      // cross-origin responses (it's not in the CORS "simple headers"
      // allowlist), so client/src/lib/download.ts can never read the
      // server's real filename and silently falls back to a generic one.
      exposedHeaders: ["Content-Disposition"],
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ data: { status: "ok", time: new Date().toISOString() } });
  });

  app.use("/api/v1", apiRouter);

  // In production, serve the Vite-built React SPA as static files.
  // The client dist is copied to /app/client-dist in the Dockerfile.
  if (isProd) {
    const clientDist = path.resolve(__dirname, "../../client-dist");
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      // SPA fallback: serve index.html for any non-API, non-asset route.
      app.get("*", (_req, res) => {
        res.sendFile(path.join(clientDist, "index.html"));
      });
    }
  } else {
    app.use(notFound);
  }

  app.use(errorHandler);

  return app;
}
