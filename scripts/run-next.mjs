import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const mode = process.argv[2];
const appArg = process.argv[3] ?? ".";
const nextArgs = process.argv.slice(4);

if (!mode || !["dev", "build", "start"].includes(mode)) {
  console.error("Usage: node scripts/run-next.mjs <dev|build|start> <app-dir>");
  process.exit(1);
}

const appDir = path.resolve(process.cwd(), appArg);
const nextDir = path.join(appDir, ".next");
const serverDir = path.join(nextDir, "server");
const chunksDir = path.join(serverDir, "chunks");
const runtimePath = path.join(serverDir, "webpack-runtime.js");
const useTurbopack = mode === "dev" && nextArgs.includes("--turbopack");

function fileContent(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function patchWebpackRuntime() {
  const runtime = fileContent(runtimePath);
  if (!runtime) {
    return false;
  }

  const source = 'require("./" + __webpack_require__.u(chunkId))';
  const target = 'require("./chunks/" + __webpack_require__.u(chunkId))';

  if (!runtime.includes(source) || runtime.includes(target)) {
    return false;
  }

  fs.writeFileSync(runtimePath, runtime.replaceAll(source, target));
  return true;
}

function mirrorServerChunks() {
  if (!fs.existsSync(chunksDir)) {
    return 0;
  }

  let mirrored = 0;

  for (const entry of fs.readdirSync(chunksDir)) {
    if (!entry.endsWith(".js")) {
      continue;
    }

    const chunkPath = path.join(chunksDir, entry);
    const targetPath = path.join(serverDir, entry);
    const chunkContent = fileContent(chunkPath);
    const targetContent = fileContent(targetPath);

    if (chunkContent && chunkContent !== targetContent) {
      fs.copyFileSync(chunkPath, targetPath);
      mirrored += 1;
    }
  }

  return mirrored;
}

function synchronizeArtifacts() {
  const patched = patchWebpackRuntime();
  const mirrored = mirrorServerChunks();
  return { patched, mirrored };
}

function nextBinary() {
  return process.platform === "win32" ? "next.cmd" : "next";
}

function cleanBuildArtifacts() {
  fs.rmSync(nextDir, { recursive: true, force: true });
}

if (mode === "dev" || mode === "build") {
  cleanBuildArtifacts();
}

if (mode === "start") {
  synchronizeArtifacts();
}

const child = spawn(nextBinary(), [mode, ...nextArgs], {
  cwd: appDir,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32"
});

let interval = null;

if (mode === "dev" && !useTurbopack) {
  interval = setInterval(() => {
    synchronizeArtifacts();
  }, 250);
}

child.on("exit", (code, signal) => {
  if (interval) {
    clearInterval(interval);
  }

  if (mode === "build" && code === 0) {
    synchronizeArtifacts();
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (interval) {
      clearInterval(interval);
    }
    child.kill(signal);
  });
}
