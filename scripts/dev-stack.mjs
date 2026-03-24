import { spawn } from "node:child_process";
import process from "node:process";

const services = [
  { name: "api", color: "\u001b[31m", command: ["npm", "run", "dev:api"] },
  { name: "worker", color: "\u001b[32m", command: ["npm", "run", "dev:worker"] },
  { name: "ops", color: "\u001b[34m", command: ["npm", "run", "dev:ops"] }
];

const reset = "\u001b[0m";
const children = [];

function prefixOutput(name, color, chunk) {
  const text = chunk.toString();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }
    process.stdout.write(`${color}[${name}]${reset} ${line}\n`);
  }
}

for (const service of services) {
  const child = spawn(service.command[0], service.command.slice(1), {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
    env: process.env,
    shell: true
  });

  child.stdout.on("data", (chunk) => prefixOutput(service.name, service.color, chunk));
  child.stderr.on("data", (chunk) => prefixOutput(service.name, service.color, chunk));
  child.on("exit", (code) => {
    if (code && code !== 0) {
      process.stderr.write(`${service.color}[${service.name}] exited with code ${code}${reset}\n`);
    }
  });

  children.push(child);
}

function shutdown(signal) {
  for (const child of children) {
    child.kill(signal);
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
