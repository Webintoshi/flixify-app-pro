import { spawn } from "node:child_process";
import process from "node:process";

const apiPort = Number(process.env.SMOKE_API_PORT ?? 4100);
const verbose = process.env.SMOKE_VERBOSE === "true";
const children = [];

function npmBinary() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function now() {
  return new Date().toISOString().slice(11, 19);
}

function log(message) {
  process.stdout.write(`[smoke-p0 ${now()}] ${message}\n`);
}

function startProcess(name, command, args, envOverrides = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...envOverrides
    },
    stdio: verbose ? "inherit" : "pipe"
  });

  if (!verbose) {
    child.stdout?.on("data", () => {});
    child.stderr?.on("data", () => {});
  }

  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0 && code !== 143) {
      log(`${name} exited with code ${code}`);
    }
  });
  return child;
}

async function waitFor(check, timeoutMs, intervalMs = 400) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await check();
      if (result) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Timeout waiting for condition.");
}

async function runApiFlow(baseUrl) {
  const register = await fetch(`${baseUrl}/auth/register-anon`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceName: "smoke-p0",
      platform: "web"
    })
  });
  if (!register.ok) {
    throw new Error(`register-anon failed: ${register.status}`);
  }
  const registerJson = await register.json();
  const code = String(registerJson.kryptoniteCode ?? "");
  if (code.length !== 16) {
    throw new Error(`register-anon returned invalid code length: ${code.length}`);
  }

  const login = await fetch(`${baseUrl}/auth/login-by-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      deviceName: "smoke-p0",
      platform: "web"
    })
  });
  if (!login.ok) {
    throw new Error(`login-by-code failed: ${login.status}`);
  }
  const loginJson = await login.json();
  const accessToken = String(loginJson.accessToken ?? "");
  if (!accessToken) {
    throw new Error("login-by-code did not return accessToken");
  }

  const me = await fetch(`${baseUrl}/me`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  if (!me.ok) {
    throw new Error(`GET /me failed: ${me.status}`);
  }

  const trial = await fetch(`${baseUrl}/me/trial-request`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      note: "smoke-p0 trial request"
    })
  });
  if (!trial.ok) {
    throw new Error(`POST /me/trial-request failed: ${trial.status}`);
  }
}

async function shutdown() {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
  }
}

async function main() {
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

  log(`Starting API on ${apiBaseUrl}`);
  startProcess("api", "node", ["apps/api/dist/server.js"], {
    API_PORT: String(apiPort)
  });

  await waitFor(async () => {
    const response = await fetch(`${apiBaseUrl}/health`, { cache: "no-store" });
    return response.ok;
  }, 30_000);
  log("API health check passed");

  await runApiFlow(apiBaseUrl);
  log("API auth smoke flow passed");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown().finally(() => process.exit(1));
  });
}

main()
  .then(async () => {
    await shutdown();
    log("All P0 smoke checks passed");
  })
  .catch(async (error) => {
    await shutdown();
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
