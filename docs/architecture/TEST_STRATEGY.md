# Estratégia de testes

## Testes locais

- `apps/*/tests/unit`: comportamento isolado de cada aplicação;
- `apps/web/tests/components`: componentes React;
- `packages/*/tests/unit`: domínio e infraestrutura isolados.

## Testes compartilhados

- `tests/integration`: dois ou mais módulos TypeScript;
- `tests/e2e`: fluxo público completo;
- `tests/security`: isolamento, uploads hostis, limites e limpeza;
- `tests/parity`: comparação com baselines privados do legado;
- `tests/fixtures`: somente dados sintéticos ou sanitizados compartilhados.

TypeScript usa Vitest e Testing Library. O legado usa Pytest dentro de `legacy/python/tests`.

## Critérios obrigatórios

- nenhuma correspondência pode reutilizar registros;
- conta bancária incompatível bloqueia a execução;
- valores usam decimal exato;
- cada resultado mantém evidência de arquivo/linha/página;
- tokens de sessões distintas não concedem acesso;
- fechamento, cancelamento e TTL não deixam resíduos;
- XLSX e interface derivam da mesma fonte de resultados.
