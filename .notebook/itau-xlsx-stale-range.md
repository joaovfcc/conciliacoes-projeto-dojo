# Itaú XLSX: intervalo e aliases
> Células físicas podem ultrapassar `!ref`; aliases concorrentes não podem sobrescrever a descrição

Entry: `packages/core/src/tabular/spreadsheet-reader.ts:parseSpreadsheet()`

Intervalo:
- `physicalWorksheetRange()` deriva a área das chaves físicas e não confia apenas em `!ref`
- área efetiva respeita limites de linhas, colunas e células antes de materializar
- `blankrows: true` + descarte posterior preserva o número real da linha Excel
- regressão: `packages/core/tests/unit/test-excel.test.ts`

Itaú:
- `packages/core/src/statements/profiles/itau-checking-xlsx-v1.ts`
- `Lançamento` = descrição principal; `Razão Social` = complemento opcional
- `CPF/CNPJ` tem precedência documental sobre `Ag/origem`
- `packages/core/src/statements/generic-statement-parser.ts:mapColumns()` respeita a ordem dos aliases
- cada coluna física ocupa no máximo um papel semântico
- regressão: `packages/core/tests/unit/statements/itau-parser.test.ts`

Saldo:
- `packages/core/src/parsers/utils.ts:statementMetadata()` só publica `finalBalance` quando a sequência de saldos é completa
- saldo parcial permanece `NOT_AVAILABLE`; nunca promover saldo intermediário a final
- o perfil Itaú captura `SALDO ANTERIOR` e o último `SALDO TOTAL`/`SALDO FINAL` como controles estruturais antes de ignorar essas linhas; elas não entram em `transactions`
- o razão Protheus usa movimento físico `débito - crédito` e efeito explícito `SUBTRACTS_FROM_BALANCE`; abertura = primeiro saldo após movimento + primeiro movimento
- a fachada `BANK_ASSET` inverte o movimento do razão para matching, mas preserva o saldo contábil na mesma orientação do saldo bancário

Validação privada 2026-08-09:
- extrato Itaú: 1.744/1.744 movimentos; razão dezembro: 2.056
- pré-análise mostra 3.800 porque agrega razão + extrato na contagem da competência
- matching completo: 563 conciliações automáticas
- saldo real: `NOT_AVAILABLE` porque as linhas transacionais não trazem saldo acumulado completo

Updated: 2026-08-12
