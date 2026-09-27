# HANDOFF — Sessão: AUTH-12 (Histórico persistente + Gate de infraestrutura real)

> Gerado ao final da sessão. Objetivo: permitir que outro coding agent continue exatamente de onde paramos.
> Branch: `codex/prd-v2-modular-reconciliation` · Workspace: `C:\Users\joao.carvalho\Desktop\projeto.dojo`

---

## Objetivo atual do projeto

Concluir o monorepo modular de conciliação bancária v2 (PRD v2) com:

1. Autenticação persistente multicontas (AUTH-01..AUTH-14) — já implementada e validada.
2. **AUTH-12**: histórico anual de conciliações concluídas persistido em PostgreSQL, escopado por organização/empresa/usuário, com uploads estritamente temporários (arquivos e credenciais nunca persistidos).
3. **Gate permanente e obrigatório de infraestrutura real** (PostgreSQL 16 + Redis 8 via Testcontainers) no CI, com a suíte executando contra bancos reais — não mocks.

## Problema que estamos resolvendo

- Conciliações existiam apenas em sessões voláteis (memória/Redis); não havia histórico consultável e anual por organização.
- Não havia prova de que o sistema funciona contra PostgreSQL/Redis reais (só testes com mocks/em memória).
- Defeitos de concorrência expostos pelo gate:
  - Fila BullMQ compartilhada em cache era fechada e reutilizada (queue stalled).
  - Redelivery após crash reprocessava sessões já concluídas.
  - Tentativas de processamento fora de ordem (A/B/C) podiam adotar histórico de forma inconsistente.
  - Cancelamento concorrente podia ser rejeitado pelo fence de processamento.
  - Rotação concorrente de refresh token falhava com P2034 (Serializable).

## Arquitetura atual

pnpm monorepo:

- `packages/core` — domínio: auth (Argon2id, JWT, refresh rotativo), reconciliação, adaptadores bancários, parsers, `CompletedReconciliation` + repositórios (Prisma/InMemory).
- `packages/runtime` — `SessionStore` (Redis com Lua / Memória), `RateLimiter` (Redis), `RuntimeServices` (process, enqueue, cleanup, compensação), filas BullMQ por operação.
- `apps/worker` — worker BullMQ; ignora redelivery de sessões com status terminal concluído.
- `apps/web` — Next.js; shell autenticado sem Web Storage; telas de histórico/exportação XLSX.

Mecanismos-chave de concorrência (estado final desta sessão):

- `claimProcessing(id, attemptId)` atômico (Lua/Memória) retorna `{ claimed: true, generation }` com **geração monotônica**; `claimConfirmation` (SAME/CONFLICT).
- `markClosed(id, status)` atômico (Lua/Memória) — cancelamento sempre vence o fence.
- `mergeSession` preserva o snapshot terminal inteiro; saves obsoletos/fenced são rejeitados (status/progress/ledgers/statements/errorCode não regridem).
- `completeSessionScript` exige `processingAttemptId` da tentativa dona.
- Repositório de histórico: `save(record, processingAttemptId, processingGeneration)` → `createMany(skipDuplicates)` + `updateMany` de adoção com CAS monotônico (`processingGeneration < novo`), em `$transaction`; `delete(id, processingAttemptId)` condicional (compare-and-delete).
- `PrismaAuthRepository.rotateRefreshToken`: retry limitado (até 4) somente para P2034.
- Compensação no `process()`: sempre emite `delete(id, processingAttemptId)` quando o histórico foi persistido (compare-and-delete torna seguro mesmo se outra tentativa adotou).

## Decisões tomadas e motivos

| Decisão | Motivo |
|---|---|
| Gate permanente via Testcontainers (usuário rejeitou validação única) | Evidência contínua e obrigatória no CI |
| PostgreSQL 16 como baseline (escolha do usuário) | Versão-alvo do produto |
| Fencing por geração monotônica (não predecessor attemptId) | Corrige adoção fora de ordem A/B/C; predecessor único era insuficiente |
| `delete` condicional por attemptId; compensar sempre que o histórico foi gravado | Achado P2 final: sessão substituída no Redis não prova posse; compare-and-delete é seguro e cobre o caso |
| `markClosed` atômico | Cancelamento/expiração devem vencer o fence de processamento |
| Não usar `infra/compose.yaml` no gate | Representa a aplicação, sem PostgreSQL, com riscos de porta |
| CI infraestrutura só em `ubuntu-latest` | Ambiente determinístico; aceito pelos revisores |
| Access JWT de 10 min só em memória; refresh opaco em cookie HttpOnly | Sem Web Storage (requisito AUTH) |
| Retenção de 1 ano-calendário (`setUTCFullYear` +1) | Requisito do PRD |
| Metadados persistidos sem `objectKey`/bytes/credenciais | Uploads estritamente temporários |
| Fixture BullMQ via entrypoint CJS (`dist/cjs/index.js`) | ESM profundo falha no Node 24 (`ERR_UNSUPPORTED_DIR_IMPORT`) |
| Prisma no teste via `process.execPath` + `process.env.npm_execpath` | `execFile("pnpm.cmd")` falha no Windows (`spawn EINVAL`) |

## Alterações já implementadas (nesta sessão)

- **Auth persistente**: `packages/core/src/auth/` (PrismaAuthRepository com retry P2034, schema/migrations 20260812120000_multicount_configuration + 20260813120000_persistent_authentication), endpoints `/api/auth/*`, `apps/web/src/lib/auth-*.ts`, componentes `authenticated-app.tsx` etc.
- **Histórico**: `CompletedReconciliation.ts`, `PrismaCompletedReconciliationRepository.ts`, `InMemoryCompletedReconciliationRepository.ts`, migration `20260813160000_completed_reconciliation_history` (colunas `processingAttemptId TEXT` + `processingGeneration INTEGER` — editadas inline, ainda não aplicadas em banco real), endpoints `/api/reconciliation-history/*`, exportação XLSX.
- **Gate de infraestrutura**:
  - `testcontainers@12.1.0` (devDep raiz); script raiz `test:infrastructure` (builda core/runtime/worker, depois `vitest run tests/infrastructure --no-file-parallelism --test-timeout=120000 --hook-timeout=180000`).
  - `pnpm-workspace.yaml`: `allowBuilds` normalizados (`cpu-features: false`, `protobufjs: false`, `ssh2: false`) — corrige `ERR_PNPM_IGNORED_BUILDS`/EPERM.
  - `tests/infrastructure/persistent-authentication.test.ts` (postgres:16-alpine + redis:8-alpine, portas aleatórias, `prisma migrate deploy`, 9 cenários) + `tests/infrastructure/fixtures/worker-crash.mjs` (fork/IPC: ready/history-persisted/stalled/completed/failed; crash bloqueia após commit; `autorun: false`; `lockDuration` 1s crash / 10s recover; `stalledInterval 500`; `maxStalledCount 1`).
  - `.github/workflows/quality.yml`: job obrigatório `infrastructure` (ubuntu-latest, Node 24, pnpm 11.9.0).
- **Correções de produção (fencing/filas)**:
  - `services.ts`: claim atômico + `processingGeneration` na sessão, fila por operação (sem cache) fechada em `finally`, compensação via `delete(id, processingAttemptId)`, `assertSessionActive`, `isCompleted`.
  - `session-store.ts`: scripts Lua com fence de tentativa e aderência terminal, `claimProcessingScript` retorna geração, `markClosedScript`, `markClosed()` (interface + Memória + Redis), `close()` em `RedisSessionStore`/`RedisRateLimiter`.
  - `processor.ts`: ignora redelivery com status `COMPLETED`/`COMPLETED_WITH_ISSUES`.
  - `PublicSession` redige `processingAttemptId` e `confirmationHash`.
- **Último patch aplicado (NÃO verificado)**: `services.ts` ~linha 130 — compensação agora incondicional: `if (historyAvailable) await this.completedReconciliations.delete(session.id, processingAttemptId);` (removida a condição `ownsAttempt`; `ownsAttempt` ainda é usado na linha 131 para decidir marcar FAILED).

## Arquivos importantes

- `tests/infrastructure/persistent-authentication.test.ts` — gate Testcontainers (o coração da entrega).
- `tests/infrastructure/fixtures/worker-crash.mjs` — worker filho crash/recover.
- `packages/runtime/src/services.ts` — process/enqueue/cleanup/compensação (linhas 79-136: fluxo de processamento com fence).
- `packages/runtime/src/session-store.ts` — Lua scripts, geração, markClosed, close.
- `packages/core/src/reconciliation/domain/CompletedReconciliation.ts` + `infrastructure/PrismaCompletedReconciliationRepository.ts` + `InMemoryCompletedReconciliationRepository.ts`.
- `packages/core/src/auth/PrismaAuthRepository.ts` — retry P2034.
- `packages/core/prisma/schema.prisma` + migrations (3 novas nesta fase).
- `apps/worker/src/processor.ts` + `apps/worker/tests/unit/processor.test.ts`.
- `packages/runtime/tests/unit/security.test.ts` — 18 testes.
- `.github/workflows/quality.yml`, `package.json` (raiz), `pnpm-workspace.yaml`.
- `.specs/features/persistent-authentication/validation.md` — validado "PASS com gaps de infraestrutura externos"; **precisa atualização** após o gate real.

## Arquivos modificados nesta sessão (git status — excluindo remoções preexistentes em `agents/skills`)

Modificados: `.env.example`, `.github/workflows/quality.yml`, `.specs/STATE.md`, `AGENTS.md`, `apps/web/**` (rotas api v2, auth, página, componentes, lib, testes), `apps/worker/src/{main,processor}.ts`, `apps/worker/tests/unit/processor.test.ts`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `packages/core/package.json`, `packages/core/prisma/schema.prisma`, `packages/core/prisma/migrations/20260813160000_completed_reconciliation_history/migration.sql`, `packages/core/src/**` (auth, reconciliation, imports, parsers, adapters), `packages/runtime/src/{index,services,session-store,types}.ts`, `packages/runtime/tests/unit/security.test.ts`, `vitest.config.ts`, `tests/{e2e,integration,security}/*`.

Novos: `tests/infrastructure/**`, `packages/core/src/auth/`, `packages/core/src/reconciliation/domain/CompletedReconciliation.ts`, `.../infrastructure/PrismaCompletedReconciliationRepository.ts`, `.../InMemoryCompletedReconciliationRepository.ts`, `packages/core/src/configuration/`, `packages/runtime/src/rate-limiter.ts`, migrations `20260812120000_*`, `20260813120000_*`, `20260813160000_*`, `apps/web/src/app/api/auth/`, `apps/web/src/app/api/reconciliation-history/`, `apps/web/src/components/authenticated-app.tsx`, `apps/web/src/lib/auth-*.ts`, `.specs/features/persistent-authentication/`, `.agents/`, `.notebook/`, `skills/`.

## Testes executados e resultados

- Após correções de fencing (antes do último patch de compensação):
  - `pnpm typecheck` — PASS (core, runtime, worker, web).
  - `pnpm lint` — PASS.
  - `pnpm build` — PASS.
  - `pnpm --filter @conciliacao/core test:unit` — 354 PASS.
  - `pnpm --filter @conciliacao/runtime test:unit` — 18 PASS (inclui novo teste "cancelamento atômico fecha o snapshot atual antes de tentar remover arquivos").
  - `apps/worker` unit — 5 PASS.
  - `node --check tests/infrastructure/fixtures/worker-crash.mjs` — PASS; import CJS do BullMQ verificado funcional.
- **Suíte de infraestrutura (`pnpm test:infrastructure`): NUNCA executada de fato** (ver Bloqueios).

## Problemas encontrados (e status)

- Docker engine parado: Docker Desktop 29.7.2 instalado/aberto, mas WSL não instalado → `docker info` retorna HTTP 500, containers Linux não rodam. **Bloqueia execução local do gate.**
- P2034 na rotação concorrente de refresh — corrigido com retry limitado.
- Fila BullMQ compartilhada fechada/reutilizada — corrigido (fila por operação).
- Redelivery após crash reprocessava concluídas — corrigido no processor.
- Adoção fora de ordem A/B/C — corrigido com geração monotônica + CAS no PostgreSQL.
- Cancelamento concorrente rejeitado pelo fence — corrigido com `markClosed`.
- `previousAttemptId` do claim substituído por `generation` — atualizado em services, repositórios, schema/migration e wrappers de teste (typecheck PASS após isso).
- Último achado P2 do revisor (compensar mesmo quando o Redis foi superseded) — corrigido no último patch; **verificação pendente**.

## Decisões rejeitadas

- Validação única/one-off de infraestrutura — rejeitada pelo usuário (quer gate permanente).
- Confiar em sessão ausente no Redis como prova de posse do histórico — rejeitada (fencing durável no PostgreSQL).
- Compensação condicionada a `ownsAttempt` — rejeitada no final (compare-and-delete torna seguro compensar sempre).
- Usar/ampliar `infra/compose.yaml` para o gate.
- ESM deep import do BullMQ no fixture.
- Persistir `objectKey`/`sha256`/credenciais nos metadados do histórico.

## Restrições importantes

- **Não executar git destrutivo, commit, push ou deploy** (não solicitados).
- **Não tocar nas centenas de remoções preexistentes em `agents/skills/`** (estado intencional do worktree; a branch tem base `main` mergida em `b83bab8`).
- Gate deve falhar fechado (sem fallback em memória); proibido `FLUSHDB`, `migrate reset` e URLs do `.env`; portas aleatórias; suíte sequencial; teardown completo (stop com removeVolumes, `prisma.$disconnect()`, `sessions.close()`, kill de filhos).
- MCP/ferramentas que exigem Docker seguirão indisponíveis enquanto o WSL não for instalado.

## Tarefas pendentes

1. **Verificar o último patch de compensação**: `pnpm typecheck`, `pnpm lint`, `pnpm build`, unit tests (core/runtime/worker).
2. **Executar `pnpm test:infrastructure`** — localmente (após instalar/ativar WSL 2 ou backend Hyper-V, com consentimento do usuário) ou via CI no job `infrastructure` (ubuntu-latest).
3. Corrigir qualquer falha real revelada pela suíte (migrations, Lua, crash recovery).
4. Atualizar `.specs/features/persistent-authentication/validation.md` com o resultado do gate e fechar a todo list.

## Próximo passo recomendado

1. Rodar gates pós-patch (typecheck/lint/build/unit) — deve ser verde.
2. Se Docker não ficar disponível localmente, disparar/aguardar o job `infrastructure` do CI para validar a suíte em ubuntu.
3. Atualizar `validation.md` e encerrar os todos restantes.

## Contexto para não refazer trabalho

- Revisores independentes da fase: session `ses_fff3a2f99ffedidsdhX2NgdlVK` (gate review — achado P2 já corrigido) e `ses_fff3a2f63ffe4EH8s7GKa84Ami` (crash analysis — aprovado, retornou vazio). Podem ser retomadas via `task_id` se necessário.
- O fluxo crítico de processamento (services.ts:79-136): claim → grava snapshot → reconciliar → **adotar histórico (CAS)** → apagar arquivos → marcar concluída; catch compensa via `delete` condicional e só marca FAILED se ainda é dono (`ownsAttempt`); finally limpa arquivos remanescentes.
- Fixture de crash depende de builds (o script `test:infrastructure` builda core/runtime/worker primeiro) e do caminho CJS do bullmq em `apps/worker/node_modules`.
- `pnpm install --frozen-lockfile` funciona; lockfile inclui testcontainers (+110 pacotes).
- Node ≥ 22/24; vitest 4; Prisma 5.22; a migration `20260813160000` foi editada inline (colunas novas) — não criar nova migration para as mesmas colunas.
- Se for executar o gate localmente, `pnpm --filter @conciliacao/core prisma:generate` antes de typecheck já foi necessário nesta sessão após mudanças no schema.
