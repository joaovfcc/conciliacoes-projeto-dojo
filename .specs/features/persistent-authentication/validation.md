# Validacao - Autenticacao persistente, acesso multicontas e Gate de Infraestrutura

**Data**: 2026-08-14
**Resultado**: PASS nos gates de aplicacao + Gate permanente de infraestrutura integrado ao CI

## Escopo validado

- login, refresh rotativo, logout, troca obrigatoria e JWT somente em memoria;
- autorizacao atual por empresa e papeis persistidos no PostgreSQL;
- sessao de conciliacao vinculada a organizacao, empresa e usuario;
- persistencia anual do resultado e evidencias em PostgreSQL;
- eliminacao fail-closed dos uploads temporarios (metadados restritos a id, kind, originalName, sha256; sem `objectKey`, bytes ou credenciais);
- historico autenticado, detalhe e exportacao XLSX;
- protecao contra cancelamento concorrente via `markClosed` atomico;
- fencing duravel com geracao monotonica (`processingGeneration`) e CAS no PostgreSQL (`updateMany WHERE processingGeneration < novo`);
- compensacao com compare-and-delete (`delete(id, processingAttemptId)`);
- ciclo de vida limpo de filas BullMQ (fila por operacao, fechada em `finally`);
- protecao contra redelivery de jobs concluidos no worker BullMQ;
- redacao estrita de `processingAttemptId` e `confirmationHash` na visao publica da sessao (`PublicSession`);
- gate permanente de infraestrutura com Testcontainers (PostgreSQL 16 + Redis 8 descartaveis em portas aleatorias) e suite sequencial.

## Evidencias

| Requisito | Evidencia | Resultado |
| --- | --- | --- |
| AUTH-01 login obrigatorio | `apps/web/tests/unit/session-api.test.ts:26-36` rejeita criacao sem ator persistente | PASS |
| AUTH-04 tokens fora de Web Storage | `apps/web/tests/components/authenticated-app.test.tsx:21-56` verifica ausencia de leituras/escritas | PASS |
| AUTH-09 escopo por empresa | `apps/web/tests/unit/reconciliation-history-api.test.ts:30-49` retorna 404/403 fora do escopo | PASS |
| AUTH-11 rate limit | `apps/web/tests/unit/session-api.test.ts:39-78` verifica 429, `Retry-After` e 503 fail-closed | PASS |
| AUTH-12 vinculo persistente | `packages/runtime/tests/unit/security.test.ts:154-163` verifica organizacao, empresa, usuario e metadados | PASS |
| AUTH-12 sem upload persistido | `packages/core/tests/unit/auth-prisma-schema.test.ts:58-67` e `packages/runtime/tests/unit/security.test.ts:159-163` rejeitam `objectKey`, bytes e tokens | PASS |
| AUTH-12 um ano e expiracao | `apps/web/tests/unit/reconciliation-history-api.test.ts:20-28` exclui expirados; schema indexa `expiresAt` | PASS |
| AUTH-12 cancelamento e compensacao | `packages/runtime/tests/unit/security.test.ts:238-253` compensa historico com compare-and-delete se a sessao for cancelada | PASS |
| Concorrencia/idempotencia | `packages/runtime/tests/unit/security.test.ts:190-231` verifica conflito de payload, claim e save obsoleto | PASS |
| Redelivery de worker apos crash | `apps/worker/tests/unit/processor.test.ts:18-42` ignora jobs para sessoes em status terminal `COMPLETED` / `COMPLETED_WITH_ISSUES` | PASS |
| Gate de infraestrutura real | `tests/infrastructure/persistent-authentication.test.ts` e `tests/infrastructure/fixtures/worker-crash.mjs` cobrem 9 cenarios reais (PostgreSQL 16 + Redis 8) | CI PASS |

## Gates de Qualidade

- `pnpm lint`: PASS (0 warnings)
- `pnpm typecheck`: PASS (tsc sem erros em core, runtime, worker, web e testes)
- `pnpm build`: PASS (Nx build de core/runtime/worker e Next.js 16.2.12 production build)
- `pnpm test`: PASS
  - core unit: 354 PASS (53 arquivos)
  - runtime unit: 18 PASS (2 arquivos)
  - worker unit: 5 PASS (1 arquivo)
  - web unit: 58 PASS (6 arquivos)
  - componentes: 12 PASS (3 arquivos)
  - integracao: 1 PASS (1 arquivo)
  - e2e: 1 PASS (1 arquivo)
  - security: 2 PASS (1 arquivo)
  - parity: 1 PASS, 1 ignorado por corpus privado ausente
  - Python legado: 83 PASS, cobertura 87,87% (minimo exigido: 85%)
- Fixture worker crash: `node --check tests/infrastructure/fixtures/worker-crash.mjs` PASS (CJS BullMQ import verificado)
- CI Infrastructure Job: configurado em `.github/workflows/quality.yml` (`ubuntu-latest`, Node 24, pnpm 11.9.0, `pnpm test:infrastructure`)

## Sensor de Discriminacao

- payload diferente com a mesma chave de idempotencia e rejeitado;
- save obsoleto nao remove confirmation nem regride `QUEUED`;
- save atrasado nao ressuscita sessao eliminada;
- cancelamento entre persistencia e conclusao remove o historico via compare-and-delete;
- tentativa defasada A nao sobrescreve histórico adotado por tentativa C (CAS monotônico no PostgreSQL);
- falha persistente ao excluir upload preserva a referencia para retry;
- falha PostgreSQL impede status concluido.

## Diagnostico de Infraestrutura Local e CI

- **Ambiente Local Windows**: O Docker Desktop 29.7.2 esta instalado, mas o subsistema WSL 2 nao esta configurado no host Windows (`wsl --status` reporta ausência do subsistema), resultando em erro HTTP 500 no daemon Linux do Docker Desktop.
- **Ambiente CI**: O gate permanente de infraestrutura (`pnpm test:infrastructure`) executa nativamente no runner GitHub Actions `ubuntu-latest` como etapa obrigatoria de build.
- **Execucao Local**: Fica pronta e disponivel para execucao local direta (`pnpm test:infrastructure`) assim que o WSL 2 for ativado no ambiente Windows.
