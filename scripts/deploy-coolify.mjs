#!/usr/bin/env node
import "dotenv/config";

const coolifyUrl = (process.env.COOLIFY_URL || "https://coolify.flixify.vip").replace(/\/+$/, "");
const token = process.env.COOLIFY_API_TOKEN;
const uuid = process.env.COOLIFY_SERVICE_UUID || "eupquokyj7qegufqvqkjmuyr";
const force = process.argv.includes("--force");

if (!token) {
  console.error("COOLIFY_API_TOKEN is missing in environment.");
  process.exit(1);
}

const deployUrl = `${coolifyUrl}/api/v1/deploy?uuid=${encodeURIComponent(uuid)}&force=${force}`;

console.log(`Triggering Coolify deployment for service ${uuid}...`);

try {
  const response = await fetch(deployUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const body = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = body;
  }

  if (!response.ok) {
    console.error(`Deploy failed: HTTP ${response.status}`, parsed);
    process.exit(1);
  }

  console.log("Deploy successfully triggered!", JSON.stringify(parsed, null, 2));
} catch (error) {
  console.error("Error triggering deploy:", error.message || error);
  process.exit(1);
}
