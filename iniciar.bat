@echo off
title Conciliador Contabil - Modo Local
chcp 65001 >nul
cls

echo ========================================================
echo         CONCILIADOR CONTABIL E FINANCEIRO
echo              Modo Local (Zero Docker)
echo ========================================================
echo.

:: Garante caminhos padroes no PATH
set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm;C:\Users\%USERNAME%\AppData\Local\Programs\Git\cmd;C:\Program Files\Git\cmd"

:: [1/4] Verificar ambiente e dependencias
echo [1/4] Verificando ambiente (Node.js e dependencias)...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] Ambiente ainda nao configurado. Executando instalador automatico...
    call "%~dp0instalar.bat"
    if %errorlevel% neq 0 (
        echo [ERRO] Falha durante a instalacao automatica.
        pause
        exit /b 1
    )
)

if not exist "%~dp0node_modules" (
    echo [INFO] Dependencias (node_modules) nao encontradas. Instalando agora...
    call "%~dp0instalar.bat"
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao instalar dependencias.
        pause
        exit /b 1
    )
)

:: [2/4] Configurar modo local (SQLite dados.db)
echo [2/4] Configurando modo local (SQLite dados.db)...
set LOCAL_MODE=true
set PORT=3000

:: [3/4] Compilar modulos do nucleo (core e runtime)
echo [3/4] Compilando modulos do nucleo (core e runtime)...
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

:: [4/4] Iniciar servidor e abrir navegador
echo [4/4] Iniciando servidor web e abrindo navegador...
echo.
echo O sistema estara acessivel em: http://localhost:3000
echo Pressione Ctrl+C para encerrar o sistema quando terminar.
echo ========================================================
echo.

start "" "http://localhost:3000"
call pnpm --filter @conciliacao/web dev
pause
