import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function getProjectRef(supabaseUrl) {
  const hostname = new URL(supabaseUrl).hostname;
  return hostname.split(".")[0];
}

async function main() {
  const sqlFileArg = process.argv[2];
  const readOnly = process.argv.includes("--read-only");

  if (!sqlFileArg) {
    console.error("Usage: npm run supabase:run-sql -- <sql-file> [--read-only]");
    process.exit(1);
  }

  const managementToken = process.env.SUPABASE_MANAGEMENT_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;

  if (!managementToken) {
    console.error("SUPABASE_MANAGEMENT_TOKEN is required.");
    process.exit(1);
  }

  if (!supabaseUrl) {
    console.error("SUPABASE_URL is required.");
    process.exit(1);
  }

  const sqlPath = path.resolve(process.cwd(), sqlFileArg);
  const query = await fs.readFile(sqlPath, "utf8");
  const projectRef = getProjectRef(supabaseUrl);

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${managementToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query,
      read_only: readOnly
    })
  });

  const text = await response.text();
  if (!response.ok) {
    console.error(text);
    process.exit(1);
  }

  console.log(text || "SQL executed successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

