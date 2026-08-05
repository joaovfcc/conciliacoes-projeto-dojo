import { access } from "node:fs/promises";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const legacyRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const venvRoot = join(legacyRoot, ".venv");
const venvPython = join(venvRoot, platform() === "win32" ? "Scripts/python.exe" : "bin/python");
const bootstrapPython = process.env.PYTHON_EXECUTABLE || "python";

if (!(await exists(venvPython))) {
  await run(bootstrapPython, ["-m", "venv", venvRoot], legacyRoot, "Não foi possível criar o ambiente do legado. Instale Python 3.11+ ou defina PYTHON_EXECUTABLE para um interpretador válido.");
}
await run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-e", ".[dev]"], legacyRoot, "Não foi possível instalar as dependências isoladas do legado Python.");
await run(venvPython, ["-m", "pytest", "-c", "pyproject.toml", "--basetemp=.pytest-tmp", "tests"], legacyRoot, "A suíte Python legada falhou.");

async function exists(path) {
  try { await access(path); return true; }
  catch { return false; }
}

function run(command, args, cwd, failureMessage) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: "inherit", windowsHide: true });
    child.once("error", () => reject(new Error(failureMessage)));
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(failureMessage)));
  });
}
