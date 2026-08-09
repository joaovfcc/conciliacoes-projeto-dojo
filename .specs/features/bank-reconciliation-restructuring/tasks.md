# Reestruturação da conciliação bancária — Tarefas

**Design**: `.specs/features/bank-reconciliation-restructuring/design.md`
**Status**: Implementação concluída; homologação de release bloqueada externamente

## Test Coverage Matrix

> Derivada de `AGENTS.md`, `vitest.config.ts`, `package.json` e do PRD.

| Camada | Tipo | Cobertura esperada | Local | Comando |
| --- | --- | --- | --- | --- |
| Domínio/engine/use case | unit | Todos os ramos e critérios `BR-*` aplicáveis | `packages/core/tests/unit` | `pnpm --filter @conciliacao/core test:unit` |
| Repository/pipeline | integration | Fluxo feliz, duplicidade e falhas críticas | `tests/integration` | `pnpm test:integration` |
| Rotas/UI/workflow | e2e/components | Fluxo feliz, transição inválida, acesso negado e erro | `tests/e2e`, `apps/web/tests/components` | `pnpm test:e2e && pnpm test:components` |
| Segurança | security | MIME, macro, isolamento e autorização | `tests/security`, `packages/runtime/tests/unit` | `pnpm test:security` |
| Schema/config | build | Geração Prisma, typecheck e build | — | `pnpm build && pnpm typecheck` |

## Gate Check Commands

| Gate | Comando |
| --- | --- |
| Quick | `pnpm --filter @conciliacao/core test:unit` |
| Full | `pnpm test:unit && pnpm test:integration && pnpm test:e2e && pnpm test:security` |
| Build | `pnpm lint && pnpm typecheck && pnpm build && pnpm test` |

## Plano de execução

1. `T01` — estabilizar scripts, Prisma e build — `BR-03`, `BR-13`.
2. `T02` — completar domínio e decimal canônico — `BR-01`, `BR-02`.
3. `T03` — implementar persistence ports, import batches, evidência e auditoria — `BR-03`.
4. `T04` — implementar fingerprint, resolução e detector genérico seguro — `BR-05`, `BR-06`.
5. `T05` — completar pipelines de extrato e razão com validações — `BR-04`, `BR-08`, `BR-09`.
6. `T06` — completar matching explicável e sugestões de cardinalidade — `BR-10`.
7. `T07` — completar exceções e workflow com guardas/RBAC — `BR-11`, `BR-12`, `BR-13`.
8. `T08` — integrar APIs V2 e mapeamento assistido na interface — `BR-07`, `BR-12`.
9. `T09` — ampliar integração, e2e, cobertura e mutation gate — `BR-13`.
10. `T10` — validação integral da definição de pronto e documentação — `BR-01` a `BR-13`.

Dependências: `T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10`.

Todos os itens modificam comportamento e incluem seus testes no mesmo ciclo. Nenhum teste existente
será removido, enfraquecido ou ignorado para obter resultado verde.

## Estado final das tarefas

| Tarefa | Status | Evidência resumida |
| --- | --- | --- |
| T01 | ✅ Concluída | Prisma gera e valida; lint, typecheck e build aprovados |
| T02 | ✅ Concluída | Domínio organizacional e decimal exato cobertos por testes |
| T03 | ✅ Concluída | Repositórios Prisma/in-memory, lotes, evidências e auditoria |
| T04 | ✅ Concluída | Fingerprint, resolução hierárquica e ambiguidade bloqueada |
| T05 | ✅ Concluída | Pipelines de extrato e razão com gates de qualidade e idempotência |
| T06 | ✅ Concluída | Matching determinístico; agrupamentos apenas como sugestão opt-in |
| T07 | ✅ Concluída | Exceções, segregação de funções, fechamento e RBAC por empresa |
| T08 | ✅ Concluída | APIs V2, inspeção/mapeamento, compatibilidade V1 e XLSX auditável |
| T09 | ✅ Concluída | Cobertura crítica 92,68%/84,68%/96,50%/96,13%; mutation score 65,42% |
| T10 | ⚠️ Bloqueada externamente | Gate local aprovado; release exige `PARITY_FIXTURES_DIR` e manifesto privado revisado |

O bloqueio de `T10` não autoriza inventar resultados do corpus. O comando
`pnpm test:parity:release` deve continuar falhando quando o oráculo privado não estiver configurado.

## Verificações do plano

| Checagem | Resultado |
| --- | --- |
| Granularidade | Cada tarefa entrega uma capacidade coesa e verificável |
| Dependências | Diagrama e ordem declarada coincidem |
| Colocação de testes | Cada tarefa comportamental inclui unit/integration/e2e correspondente |
