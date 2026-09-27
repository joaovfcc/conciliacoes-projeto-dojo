# Localização da apresentação
> Enums internos permanecem estáveis; cliente e XLSX exibem rótulos em português

Entry: `packages/core/src/presentation.ts`

Flow: domínio/API → funções de apresentação → cliente ou relatório XLSX
- Cliente: `apps/web/src/components/reconciliation-app.tsx`
- XLSX da sessão: `packages/core/src/reporting.ts:generateXlsx()`
- XLSX V2: `packages/core/src/reconciliation/application/ReconciliationReport.ts:generateReconciliationRunXlsx()`

Catálogos tipados: resultado, regra, nível de decisão, método, documento, saldo, investimento, execução, cardinalidade e exceção.
- Código dinâmico de issue desconhecido → rótulo genérico em português; identificador interno não vira texto principal.
- Identificador de parser → `packages/core/src/presentation.ts:parserLabel()`.

Gotcha de bundle:
- Cliente importa valores por `@conciliacao/core/presentation`, nunca pelo índice geral do core.
- Índice geral exporta módulos Node (`node:fs/promises`) e quebra o bundle do navegador.
- Subcaminho: `packages/core/package.json`; aliases de teste: `apps/web/vitest.config.ts` e `vitest.config.ts`.

Regressões: `packages/core/tests/unit/presentation.test.ts`, `packages/core/tests/unit/reporting.test.ts`, `packages/core/tests/unit/reconciliation-report.test.ts`, `apps/web/tests/components/reconciliation-app.test.tsx`.

Updated: 2026-08-09
