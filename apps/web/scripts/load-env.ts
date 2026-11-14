import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const rootDir = path.resolve(appDir, "../..");

// In dotenv, default behavior is not to overwrite existing process.env keys.
// Therefore, load more specific files (.env.local) first so they take precedence.
const envFiles = [
  path.resolve(appDir, ".env.local"),
  path.resolve(appDir, ".env"),
  path.resolve(rootDir, ".env.local"),
  path.resolve(rootDir, ".env"),
];

for (const envPath of envFiles) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

