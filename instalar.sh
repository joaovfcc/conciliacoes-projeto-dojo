#!/usr/bin/env bash
set -e

echo "========================================================"
echo "      CONCILIADOR CONTABIL - INSTALACAO AUTOMATICA"
echo "========================================================"
echo ""

# 1. Verificar Node.js
if ! command -v node &> /dev/null; then
    echo "[ERRO] Node.js nao encontrado no sistema."
    echo "Por favor instale o Node.js v22 ou v24 LTS (https://nodejs.org)."
    exit 1
fi
echo "[OK] Node.js detectado: $(node -v)"

# 2. Verificar ou instalar pnpm
if ! command -v pnpm &> /dev/null; then
    echo "[INFO] pnpm nao encontrado. Instalando globalmente via npm..."
    npm install -g pnpm || corepack enable
fi
echo "[OK] pnpm detectado: $(pnpm -v)"

# 3. Configurar variaveis de ambiente
if [ ! -f ".env" ]; then
    echo "[INFO] Criando .env a partir de .env.example..."
    cp .env.example .env
fi

if [ ! -f "apps/web/.env.local" ]; then
    echo "[INFO] Criando apps/web/.env.local..."
    mkdir -p apps/web
    cat << 'EOF' > apps/web/.env.local
LOCAL_MODE=true
APP_ORIGIN=http://localhost:3000
ANTIVIRUS_REQUIRED=false
MAX_SESSIONS_PER_HOUR=1000
EOF
fi
echo "[OK] Arquivos de ambiente configurados."

# 4. Instalar dependencias
echo "[INFO] Instalando dependencias do monorepo (pnpm install)..."
pnpm install

# 5. Compilar pacotes centrais
echo "[INFO] Compilando modulos core e runtime..."
pnpm --filter @conciliacao/core build
pnpm --filter @conciliacao/runtime build

echo ""
echo "========================================================"
echo "  INSTALACAO CONCLUIDA! Para iniciar:"
echo "  pnpm dev:local"
echo "========================================================"
