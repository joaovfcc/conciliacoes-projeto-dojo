@echo off
title Conciliador Contabil - Instalador Automatico
chcp 65001 >nul
cls

echo ========================================================
echo       CONCILIADOR CONTABIL - INSTALACAO AUTOMATICA
echo ========================================================
echo.

:: Garante que caminhos comuns do Node e npm estejam no PATH desta sessao
set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm;C:\Users\%USERNAME%\AppData\Local\Programs\Git\cmd;C:\Program Files\Git\cmd"

:: [1/5] Verificar ou Instalar Node.js
echo [1/5] Verificando instalacao do Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] Node.js nao encontrado. Instalando automaticamente via winget...
    where winget >nul 2>nul
    if %errorlevel% equ 0 (
        winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"
    ) else (
        echo [INFO] winget nao disponivel. Baixando Node.js oficial via PowerShell...
        powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile '%TEMP%\node_installer.msi'"
        echo [INFO] Executando instalador silencioso...
        msiexec.exe /i "%TEMP%\node_installer.msi" /qn /norestart
        set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"
    )
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Nao foi possivel instalar o Node.js automaticamente.
    echo Por favor, acesse https://nodejs.org e instale a versao LTS manualmente.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo [OK] Node.js detectado: %NODE_VERSION%

:: [2/5] Verificar ou Instalar pnpm
echo.
echo [2/5] Verificando instalacao do pnpm...
where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] pnpm nao encontrado. Instalando globalmente via npm...
    call npm install -g pnpm
    set "PATH=%PATH%;%APPDATA%\npm"
)

where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo [AVISO] Tentando habilitar pnpm via corepack...
    call corepack enable
)
echo [OK] pnpm pronto para uso.

:: [3/5] Configurar variaveis de ambiente locais
echo.
echo [3/5] Configurando arquivos de ambiente (.env)...
if not exist ".env" (
    echo [INFO] Criando .env a partir do .env.example...
    copy ".env.example" ".env" >nul
)
if not exist "apps\web\.env.local" (
    echo [INFO] Criando apps\web\.env.local para Modo Local...
    (
        echo LOCAL_MODE=true
        echo APP_ORIGIN=http://localhost:3000
        echo ANTIVIRUS_REQUIRED=false
        echo MAX_SESSIONS_PER_HOUR=1000
    ) > "apps\web\.env.local"
)
echo [OK] Arquivos de ambiente configurados.

:: [4/5] Instalar dependencias do monorepo
echo.
echo [4/5] Instalando dependencias do projeto (pnpm install)...
call pnpm install
if %errorlevel% neq 0 (
    echo [ERRO] Falha ao instalar dependencias do projeto.
    pause
    exit /b 1
)
echo [OK] Dependencias instaladas com sucesso.

:: [5/5] Compilar pacotes centrais (core e runtime)
echo.
echo [5/5] Compilando modulos do nucleo (core e runtime)...
call pnpm --filter @conciliacao/core build
if %errorlevel% neq 0 (
    echo [ERRO] Falha ao compilar @conciliacao/core!
    pause
    exit /b 1
)
call pnpm --filter @conciliacao/runtime build
if %errorlevel% neq 0 (
    echo [ERRO] Falha ao compilar @conciliacao/runtime!
    pause
    exit /b 1
)
echo [OK] Modulos compilados com sucesso.

echo.
echo ========================================================
echo       INSTALACAO E PREPARACAO CONCLUIDAS COM SUCESSO!
echo ========================================================
echo.
echo Agora o sistema esta 100%% pronto para rodar.
echo Para iniciar, basta dar duplo clique em:
echo       iniciar.bat
echo.
