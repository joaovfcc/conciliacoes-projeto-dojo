import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

process.env.BOOTSTRAP_ORGANIZATION_ID = process.env.BOOTSTRAP_ORGANIZATION_ID || "org-default-001";
process.env.BOOTSTRAP_ORGANIZATION_NAME = process.env.BOOTSTRAP_ORGANIZATION_NAME || "Organização Matriz";
process.env.BOOTSTRAP_OWNER_EMAIL = process.env.BOOTSTRAP_OWNER_EMAIL || "admin@conciliacao.local";
process.env.BOOTSTRAP_OWNER_PASSWORD = process.env.BOOTSTRAP_OWNER_PASSWORD || "AdminDevPassword123!";

const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

execSync(`${pnpmCmd} --filter @conciliacao/core auth:bootstrap-owner`, {
  stdio: "inherit",
  env: process.env,
});
