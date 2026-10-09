@echo off
title Conciliador Contabil - Modo Local
chcp 65001 >nul
cls
echo ========================================================
echo         CONCILIADOR CONTABIL E FINANCEIRO
echo              Modo Local (Zero Docker)
echo ========================================================
echo.
echo [1/4] Verificando ambiente Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao encontrado no sistema!
    echo Por favor instale o Node.js v22 ou v24 para continuar.
    pause
    exit /b 1
)

echo [2/4] Configurando modo local (SQLite dados.db)...
set LOCAL_MODE=true
set PORT=3000

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

echo [4/4] Iniciando servidor web e abrindo navegador...
echo.
echo O sistema estara acessivel em: http://localhost:3000
echo Pressione Ctrl+C para encerrar o sistema quando terminar.
echo ========================================================
echo.

start "" "http://localhost:3000"
call pnpm --filter @conciliacao/web dev
pause
