import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(packageDirectory, "dist");

if (basename(target) !== "dist" || dirname(target) !== packageDirectory) {
  throw new Error("Diretório de build do core não pôde ser validado com segurança.");
}

await rm(target, { recursive: true, force: true });
