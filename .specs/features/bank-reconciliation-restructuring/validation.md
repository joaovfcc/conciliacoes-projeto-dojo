# Reestruturação da conciliação bancária — validação

**Data**: 2026-08-09
**Spec**: `.specs/features/bank-reconciliation-restructuring/spec.md`
**Fonte**: `C:/Users/joao.carvalho/Downloads/plano-reestruturacao-conciliacao-bancaria.md`
**Diff**: árvore de trabalho existente; mudanças do usuário foram preservadas
**Verificador**: agente primário em passe de validação read-only; subagente independente indisponível pela política desta sessão

## Veredito

**Implementação técnica: PASS. Homologação contábil de release: BLOQUEADA EXTERNAMENTE.**

Todos os gates locais passam. A única pendência obrigatória é executar a paridade contra os PDFs
privados com um manifesto de resultados esperados aprovado por responsável contábil. O sistema
deliberadamente não inventa esse oráculo e o gate de release falha na ausência dele.

## Conclusão das tarefas

| Tarefa | Resultado |
| --- | --- |
| T01–T08 | ✅ Implementação e testes concluídos |
| T09 | ✅ Cobertura e mutation gate aprovados |
| T10 | ⚠️ Gate local aprovado; paridade privada bloqueada externamente |

## Rastreabilidade dos requisitos

| Requisito | Resultado esperado | Evidência de teste | Resultado |
| --- | --- | --- | --- |
| BR-01 | Escopo por empresa/contas/perfil | `packages/core/tests/unit/reconciliation-scope.test.ts:96` — `expect(result.matchGroups).toHaveLength(1)` | ✅ |
| BR-02 | Decimal exato e origem canônica | `packages/core/tests/unit/domain-models.test.ts:14` — `expect(decimalString("0.1")).toBe("0.10")` | ✅ |
| BR-03 | Idempotência e estados persistentes | `packages/core/tests/unit/import-batch.test.ts:29` — duplicidade localizada por empresa/conta/hash | ✅ |
| BR-04 | Pipeline valida, persiste e audita | `packages/core/tests/unit/import-pipeline.test.ts:45` — status `VALIDATED`, transações e auditoria | ✅ |
| BR-05 | Resolução por vínculo e versão | `packages/core/tests/unit/layouts.test.ts:71` — layout da conta tem precedência | ✅ |
| BR-06 | Ambiguidade bloqueada | `packages/core/tests/unit/layouts.test.ts:78` — match nulo e `LAYOUT_AMBIGUOUS` | ✅ |
| BR-07 | Preview e papéis assistidos | `packages/core/tests/unit/layouts.test.ts:137` — papéis sugeridos e preview normalizado | ✅ |
| BR-08 | Gates bancários críticos | `packages/core/tests/unit/statement-gates.test.ts:143` — estrutura, valor, saldo e mapping bloqueiam | ✅ |
| BR-09 | Razão requer vínculo contábil | `packages/core/tests/unit/import-pipeline.test.ts:87` — `NEEDS_MAPPING/REJECTED` e zero persistência | ✅ |
| BR-10 | Cascata e evidência determinística | `packages/core/tests/unit/reconciliation-engine-v2.test.ts:49` — regra por descrição e evidência completa | ✅ |
| BR-11 | Exceções estruturadas e relatório | `packages/core/tests/unit/reconciliation-report.test.ts:56` — resumo, exceções, evidências e auditoria | ✅ |
| BR-12 | Workflow, comentário e segregação | `packages/core/tests/unit/workflow-and-authorization.test.ts:67` — fechamento; linha 85 bloqueia autorrevisão | ✅ |
| BR-13 | Segurança, isolamento e gates | `apps/web/tests/unit/v2-auth.test.ts:27` e `tests/security/account-mapping-gate.test.ts:37` | ✅ local |

## Casos de borda confirmados

- [x] saldo nunca vira transação;
- [x] divergência de saldo intermediária permanece falha mesmo se o saldo final voltar a fechar;
- [x] investimentos são informativos e nunca entram no matching automático;
- [x] conta bancária incompatível não alcança o reconciliador;
- [x] layout ambíguo exige revisão/mapeamento;
- [x] importação duplicada não persiste novo lote;
- [x] agrupamentos 1:N, N:1 e N:N ficam desligados por padrão e nunca são auto-confirmados;
- [x] fórmula de planilha é neutralizada na exportação;
- [x] token V2 adulterado, expirado ou sem papel da empresa é rejeitado;
- [x] conciliação fechada é imutável e não fecha com exceção aberta.

## Gate integral

- **Comando**: `pnpm lint && pnpm typecheck && pnpm build && pnpm test`
- **Resultado**: exit code 0 em 192,6 s.
- **TypeScript**: 177 testes aprovados.
- **Python legado**: 83 testes aprovados; cobertura 87,87%.
- **Total**: 260 testes aprovados, zero falhas.
- **Skip local**: 1 teste de corpus privado, justificado pela ausência de `PARITY_FIXTURES_DIR`.
- **Prisma**: schema válido e migration inicial presente.
- **Ignore check**: `packages/runtime/src/services.ts` não está ignorado.

## Cobertura crítica

| Métrica | Resultado | Gate |
| --- | ---: | ---: |
| Statements | 92,68% | 85% |
| Branches | 84,68% | 70% |
| Functions | 96,50% | 85% |
| Lines | 96,13% | 85% |

## Discrimination sensor — Stryker

O mutation testing cobre, sem exclusão de regra financeira, `balance.ts`, `statement-gates.ts`,
`ReconciliationEngine.ts` e `Decimal.ts`.

| Estado | Quantidade |
| --- | ---: |
| Eliminados | 612 |
| Sobreviventes | 286 |
| Sem cobertura | 38 |
| Timeout | 1 |
| Total | 937 |

- **Score global**: 65,42% (`low=65`, `break=55`).
- **Score entre mutantes cobertos**: 68,19%.
- **Resultado do gate**: ✅ PASS.
- **Dívida rastreada**: classificar equivalentes e elevar progressivamente o score; nenhum mutator de
  regra financeira foi excluído para obter o resultado.

## Gate de paridade de release

- **Comando**: `pnpm test:parity:release`
- **Resultado atual**: exit code 1 proposital.
- **Motivo**: `PARITY_REQUIRED=1` e ausência de corpus/manifesto privado homologado.
- **Para desbloquear**: fornecer `PARITY_FIXTURES_DIR` contendo os PDFs referenciados por hash e
  `statement-parser-manifest.json` com classificação, adapter/versão, banco/agência/conta, período,
  quantidades e controles de saldo aprovados por responsável contábil.

## Qualidade de código

| Verificação | Resultado |
| --- | --- |
| Alterações restritas ao PRD | ✅ |
| Decimal exato no boundary financeiro | ✅ |
| Compatibilidade V1 preservada | ✅ |
| API V2 autorizada por papel e empresa | ✅ |
| Erros críticos falham de forma fechada | ✅ |
| Evidência/auditoria reproduzível | ✅ |
| Diretrizes seguidas | `AGENTS.md`, `coding-guidelines`, `tlc-spec-driven` |

## Próximo passo externo

Executar `pnpm test:parity:release` com o corpus privado e revisar qualquer divergência com o
responsável contábil. Somente depois desse resultado verde a homologação contábil/release integral
pode ser declarada.
