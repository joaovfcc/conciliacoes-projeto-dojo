# Autenticação persistente, acesso multicontas e Gate de Infraestrutura - Tarefas

**Design**: `.specs/features/persistent-authentication/design.md`
**Status**: Concluído

## Execution Protocol (MANDATORY -- do not skip)

Implementar com a skill `tlc-spec-driven`, preservando testes existentes e executando verificação independente ao final.

## Test Coverage Matrix

> Derivada de `AGENTS.md`, `package.json`, `.github/workflows/quality.yml`, `vitest.config.ts` e da spec.

| Camada | Tipo | Cobertura esperada | Local | Comando |
| --- | --- | --- | --- | --- |
| Domínio/auth service | unit | Todos os ramos de AUTH-02 a AUTH-06 e edge cases | `packages/core/tests/unit` | `pnpm --filter @conciliacao/core test:unit` |
| Prisma/migration | integration/build | Base vazia, unicidade, FKs e rotação concorrente | `tests/integration` | `pnpm test:integration` |
| Rotas auth/V2 | unit/security | Sucesso, 400, 401, 403, 429, 503 e headers | `apps/web/tests/unit`, `tests/security` | `pnpm --filter @conciliacao/web test:unit && pnpm test:security` |
| Client | component/e2e | Login, restore, refresh único, troca e logout | `apps/web/tests/components`, `tests/e2e` | `pnpm test:components && pnpm test:e2e` |
| Runtime/Fencing | unit | Fencing monotônico, markClosed atômico e compensação | `packages/runtime/tests/unit` | `pnpm --filter @conciliacao/runtime test:unit` |
| Worker/Redelivery | unit | Proteção contra reprocessamento em status terminal | `apps/worker/tests/unit` | `pnpm --filter @conciliacao/worker test:unit` |
| Gate de Infraestrutura | infrastructure | PostgreSQL 16 + Redis 8 reais via Testcontainers | `tests/infrastructure` | `pnpm test:infrastructure` |
| Schema/config/docs | build | Prisma validate, typecheck, lint e build | - | `pnpm typecheck && pnpm lint && pnpm build` |

## Gate Check Commands

| Gate | Comando |
| --- | --- |
| Quick | `pnpm --filter @conciliacao/core test:unit && pnpm --filter @conciliacao/web test:unit` |
| Full Unit & Security | `pnpm test:unit && pnpm test:components && pnpm test:integration && pnpm test:e2e && pnpm test:security` |
| Infrastructure Gate | `pnpm test:infrastructure` (CI `ubuntu-latest` / Local com WSL 2) |
| Monorepo Build & Test | `pnpm lint && pnpm typecheck && pnpm build && pnpm test` |

## Plano

1. `T01` - especificação e decisões - `AUTH-01` a `AUTH-14`.
2. `T02` - schema, migration e dependências - `AUTH-02` a `AUTH-06`, `AUTH-08`, `AUTH-09`, `AUTH-12`.
3. `T03` - domínio, repositório e serviço auth com testes - `AUTH-02` a `AUTH-06`, `AUTH-10`.
4. `T04` - JWT, cookies, CSRF e rotas auth com testes - `AUTH-01`, `AUTH-03` a `AUTH-07`, `AUTH-10`.
5. `T05` - limiter Redis e proteção de endpoints - `AUTH-11`.
6. `T06` - autorização persistida V2 e gestão OWNER - `AUTH-08`, `AUTH-09`, `AUTH-14`.
7. `T07` - client autenticado e componentes - `AUTH-10`, `AUTH-13`.
8. `T08` - persistência/histórico, gates completos e verifier - `AUTH-12` e definição de pronto.
9. `T09` - gate permanente de infraestrutura com Testcontainers (PostgreSQL 16 + Redis 8), worker crash recovery determinístico e job CI.

Dependências: `T01 -> T02 -> T03 -> T04 -> T05 -> T06 -> T07 -> T08 -> T09`.

## Validações do plano

| Tarefa | Camada | Teste exigido | Status |
| --- | --- | --- | --- |
| T01 | docs/spec | build | OK |
| T02 | schema | build/integration | OK |
| T03 | domínio/service | unit | OK |
| T04 | rotas | unit/security | OK |
| T05 | runtime/rotas | unit/security | OK |
| T06 | autorização/rotas | unit/security | OK |
| T07 | React | component/e2e | OK |
| T08 | persistência/integração | integration/full | OK |
| T09 | infraestrutura/CI | infrastructure/CI | OK |

O diagrama linear coincide com todas as dependências declaradas. Cada tarefa entrega uma capacidade coesa e inclui os testes exigidos pela camada.
