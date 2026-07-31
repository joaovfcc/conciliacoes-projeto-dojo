@echo off
setlocal
set "PROJECT_DIR=%~dp0"
set "PYTHON_EXE=%PROJECT_DIR%.venv\Scripts\python.exe"
set "APP_EXE=%PROJECT_DIR%dist\conciliacao.exe"

if exist "%APP_EXE%" (
  "%APP_EXE%" run --base-dir "%PROJECT_DIR%" %*
  exit /b %ERRORLEVEL%
)

if not exist "%PYTHON_EXE%" (
  echo Aplicacao nao encontrada em dist e ambiente Python nao encontrado em .venv.
  echo Consulte o README.md para instalar ou gerar o executavel.
  exit /b 2
)

"%PYTHON_EXE%" -m conciliacao run --base-dir "%PROJECT_DIR%" %*
exit /b %ERRORLEVEL%
