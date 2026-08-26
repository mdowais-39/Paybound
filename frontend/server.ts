// Dev/prod host for the frontend. It ONLY serves the built app — there is no
// mock backend here anymore. The frontend talks directly to the real Rust/
// Python services (gateway :8080, agent API :8092); see src/lib/config.ts.
// (The former src/server/routes/* — a TypeScript reimplementation of the
// kernel — was removed so nothing can silently fall back to fabricated data.)

import express, { Request, Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  // 3000 collides with Grafana from the backend infra; default to 5173.
  const PORT = Number(process.env.PORT) || 5173;

  // Liveness only. This host serves the SPA; all data comes from the real backend.
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "paybound-frontend-host" });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Paybound frontend host running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
