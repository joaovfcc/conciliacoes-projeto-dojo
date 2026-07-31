$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $PSScriptRoot
$pythonExecutable = Join-Path $projectDirectory ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    throw "Ambiente .venv não encontrado. Consulte o README.md."
}

& $pythonExecutable -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --name conciliacao `
    --collect-all openpyxl `
    --exclude-module pandas `
    --exclude-module numpy `
    --exclude-module pytest `
    --exclude-module coverage `
    --exclude-module ruff `
    (Join-Path $projectDirectory "scripts\entrypoint.py")

if ($LASTEXITCODE -ne 0) {
    throw "A geração do executável falhou com código $LASTEXITCODE."
}

Write-Output "Executável criado em dist\conciliacao.exe"
