# Lote 4: Paulista, Pine e Vórtx
> Adapters textuais cobrem cinco famílias de conta corrente; sem homologação contábil

Entry: `packages/core/src/adapters/index.ts:registeredV2Adapters`

Paulista:
- `packages/core/src/adapters/paulista.ts`
- dois layouts: demonstrativo e conta vinculada
- demonstrativo: data de lançamento + processamento + D/C
- conta vinculada sem movimentos é válida quando período e saldos estruturais existem

Pine:
- `packages/core/src/adapters/pine.ts`
- histórico pode vir em linha anterior à data/valor; saldo nunca vira movimento

Vórtx:
- `packages/core/src/adapters/vortx.ts`
- transações trazem data/hora, valor e saldo; controle usa saldos inicial/final
- carteira de debêntures continua sem adapter próprio

Status:
- `packages/core/src/corpus-support-matrix.ts:PDF_CORPUS_SUPPORT_MATRIX`
- todos permanecem `PARTIAL_ADAPTER` até fixture, controle e oráculo privado aprovados

Regressão:
- `packages/core/tests/unit/adapters/lot-4-current-accounts.test.ts`

Updated: 2026-09-01
