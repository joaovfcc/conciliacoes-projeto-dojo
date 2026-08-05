# Testes compartilhados

Esta árvore contém somente testes que atravessam dois ou mais apps/pacotes:

- `integration`: integração entre web, runtime e core;
- `e2e`: fluxo público completo;
- `security`: limites e isolamento exercitados entre camadas;
- `parity`: comparação com o baseline privado do legado Python;
- `fixtures`: dados sintéticos compartilhados.

Testes unitários e de componentes permanecem no workspace responsável.
