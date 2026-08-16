# Guia de Operação — Ambiente Local com WSL2, Docker Desktop e PostgreSQL 18

Este documento orienta a preparação, execução e manutenção do ambiente de desenvolvimento local utilizando **Windows 11**, **WSL2 (Ubuntu)**, **Docker Desktop** e **PostgreSQL 18**.

---

## 1. Arquitetura do Ambiente

```text
Windows 11
│
├── VS Code (com extensão WSL)
├── Navegador (http://localhost:3000)
├── Ferramentas de BD no Windows (DBeaver/DataGrip via localhost:5432)
│
└── WSL2 (Ubuntu)
      │
      └── ~/projects/projeto.dojo
            │
            ├── Aplicação Node.js 24 / TypeScript (pnpm dev)
            ├── Prisma Migrations (pnpm db:migrate)
            ├── compose.yaml
            ├── .env
            │
            └── Docker Desktop (WSL2 Backend Engine)
                  │
                  └── app-postgres (Container PostgreSQL 18)
                        │
                        └── postgres_data (Docker Named Volume: /var/lib/postgresql)
```

---

## 2. Pré-requisitos & Instalação

### A. Instalação do WSL2 no Windows
No PowerShell (como Administrador):
```powershell
# 1. Instalar WSL2 com a distribuição Ubuntu padrão
wsl --install

# 2. Verificar a versão instalada
wsl -l -v
```
Certifique-se de que a coluna `VERSION` indica `2`. Caso necessário:
```powershell
wsl --set-default-version 2
wsl --set-version Ubuntu 2
```

### B. Instalação e Configuração do Docker Desktop
1. Instale o **Docker Desktop** para Windows.
2. Nas configurações do Docker Desktop:
   * **General**: Marque `Use the WSL 2 based engine`.
   * **Resources → WSL Integration**: Habilite a integração com a distribuição `Ubuntu`.
3. Reinicie o Docker Desktop se solicitado.

### C. Validação dentro do WSL2 (Ubuntu)
Abra o terminal do Ubuntu no WSL2 e execute:
```bash
docker --version
docker compose version
docker info
```
O Docker responderá diretamente dentro do WSL sem necessidade de instalar o Docker Engine dentro da distribuição Linux.

---

## 3. Inicialização Rápida (Passo a Passo)

```bash
# 1. Clonar o repositório dentro do filesystem Linux (~/projects)
cd ~/projects
git clone <URL_DO_REPOSITORIO> projeto.dojo
cd projeto.dojo

# 2. Configurar o arquivo de variáveis de ambiente
cp .env.example .env

# 3. Instalar as dependências do projeto
pnpm install

# 4. Iniciar o container do PostgreSQL 18 em segundo plano
pnpm docker:up
# ou: docker compose up -d postgres

# 5. Executar as migrações do banco de dados (Prisma)
pnpm db:migrate

# 6. (Opcional) Criar o usuário inicial para desenvolvimento
pnpm db:seed

# 7. Iniciar o servidor de desenvolvimento da aplicação
pnpm dev
```

Acesse a aplicação no navegador em [http://localhost:3000](http://localhost:3000).

---

## 4. Variáveis de Ambiente & Conexão

No arquivo `.env`:
```env
# Configuração do Container PostgreSQL 18
POSTGRES_DB=app
POSTGRES_USER=app
POSTGRES_PASSWORD=change-me
POSTGRES_PORT=5432

# URL de Conexão da Aplicação / Prisma
DATABASE_URL=postgresql://app:change-me@localhost:5432/app
```

* **Conexão via Aplicação (Host/WSL)**: `postgresql://app:change-me@localhost:5432/app`
* **Conexão via DBeaver / DataGrip (Windows)**:
  * Host: `localhost`
  * Porta: `5432`
  * Database: `app`
  * Usuário: `app`
  * Senha: `<sua senha definida no .env>`

---

## 5. Scripts de Automação no `package.json`

| Comando | Descrição |
|---|---|
| `pnpm docker:up` | Sobe o container `app-postgres` com healthcheck ativo (`docker compose up -d`) |
| `pnpm docker:down` | Para e remove os containers, preservando os dados no volume |
| `pnpm docker:ps` | Exibe o status e healthcheck dos containers |
| `pnpm docker:logs` | Acompanha os logs de todos os containers |
| `pnpm db:logs` | Acompanha os logs específicos do PostgreSQL (`docker compose logs -f postgres`) |
| `pnpm db:migrate` | Aplica todas as migrações pendentes no banco via Prisma |
| `pnpm db:seed` | Executa o bootstrap do usuário owner para desenvolvimento |

---

## 6. Procedimentos de Manutenção & Banco de Dados

### Acesso ao CLI do PostgreSQL (`psql`)
```bash
docker compose exec postgres psql -U app -d app
```
Para testar a versão:
```sql
SELECT version();
```

### Backup Local (`pg_dump`)
```bash
docker compose exec postgres pg_dump -U app -d app > backup.sql
```

### Restore Local (`psql`)
```bash
cat backup.sql | docker compose exec -T postgres psql -U app -d app
```

### Reset Completo do Banco (Operação Destrutiva)
> [!CAUTION]
> O comando `docker compose down -v` **remove o volume nomeado** `postgres_data` e apaga permanentemente todos os dados locais.

Para reconstruir o banco do zero:
```bash
# 1. Derrubar e destruir os volumes
docker compose down -v

# 2. Subir novamente o container limpo
pnpm docker:up

# 3. Reaplicar as migrações e seeds
pnpm db:migrate
pnpm db:seed
```

---

## 7. Bateria de Testes de Conformidade (PRD Seção 38)

| # | Teste | Comando de Execução | Resultado Esperado |
|---|---|---|---|
| **1** | Docker Info | `docker info` | Executa sem erros e lista o backend WSL2. |
| **2** | Validação Compose | `docker compose config` | Retorna o YAML validado do serviço `postgres`. |
| **3** | Status do PostgreSQL | `docker compose ps` | Container `app-postgres` com status `healthy`. |
| **4** | Conexão SQL | `docker compose exec postgres psql -U app -d app -c "SELECT 1;"` | Retorna `1`. |
| **5** | Persistência de Volume | Criar tabela de teste → `docker compose down` → `docker compose up -d` → Consultar tabela | Dados permanecem intactos no volume nomeado. |
| **6** | Reconstrução Limpa | `docker compose down -v` → `pnpm docker:up` → `pnpm db:migrate` | Banco recriado do zero com sucesso. |
