# Scripts do monorepo

Esta pasta é reservada para automações da implementação TypeScript. Scripts exclusivos da
implementação Python ficam em `legacy/python/scripts`.

`pnpm inventory:private-corpus` exige `PRIVATE_CORPUS_ZIP` e `PRIVATE_CORPUS_REPORT` apontando
para caminhos absolutos privados. Ele mostra somente contagens agregadas e grava hash,
classificação, família do parser e códigos de diagnóstico; nunca nomes, contas, valores ou texto.

`pnpm test:private-statements` executa cada PDF privado isoladamente e depois repete o corpus em
lotes de até cinco extratos pelo runtime completo de upload e pré-análise. Exige
`PRIVATE_STATEMENTS_DIR`, `PRIVATE_LEDGER_FILE` e `PRIVATE_STATEMENT_TEST_REPORT`; o relatório
também usa somente hashes e diagnósticos técnicos.
