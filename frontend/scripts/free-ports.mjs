// Kills anything left listening on the frontend's dev ports before `npm run
// dev` starts. Runs automatically as `predev` (npm's pre-hook convention).
//
// Why this exists: closing a terminal window (instead of Ctrl+C) can leave
// the vite/tsx process orphaned but still bound to the port, so the next
// `npm run dev` fails with EADDRINUSE. This makes that class of error
// impossible to hit by accident.
import { execSync } from "node:child_process";

const PORTS = [5173, 24678]; // dev server + vite HMR websocket

if (process.platform !== "win32") {
  process.exit(0); // this project only targets the Windows dev box
}

for (const port of PORTS) {
  try {
    const out = execSync(`netstat -ano -p tcp`, { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split("\n")) {
      if (line.includes(`:${port} `) && /LISTENING/i.test(line)) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== "0") pids.add(pid);
      }
    }
    for (const pid of pids) {
      console.log(`[free-ports] port ${port} held by stale pid ${pid} — freeing it`);
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
      } catch {
        /* already gone, or needs elevation we don't have — dev will just fail loudly if so */
      }
    }
  } catch {
    /* netstat unavailable — nothing we can do, let dev fail with its normal error */
  }
}
