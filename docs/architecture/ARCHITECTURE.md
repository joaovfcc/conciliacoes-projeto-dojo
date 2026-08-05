# Arquitetura atual

## Componentes

O repositório é um monorepo pnpm com duas aplicações e dois pacotes compartilhados.

```text
apps/web -> packages/runtime -> packages/core
apps/worker -> packages/runtime -> packages/core
```

`core` não conhece HTTP, Redis, S3 ou Next.js. `runtime` implementa os adaptadores de
infraestrutura. `web` apresenta a API e a interface. `worker` executa OCR e conciliação fora do
processo web quando Redis está configurado.

## Fluxo

1. O navegador cria uma sessão anônima e guarda o token em `sessionStorage`.
2. A API autoriza uploads temporários e valida assinatura, limites e conteúdo.
3. A pré-análise normaliza razão/extratos, detecta competência e propõe relacionamentos.
4. O usuário confirma empresa, filial, competência, tolerâncias e mapeamentos.
5. O runtime bloqueia metadados bancários incompatíveis e chama o motor puro.
6. Resultados são exibidos em tela; o XLSX é gerado sob demanda e descartado.
7. Heartbeat, encerramento ou TTL removem sessão, arquivos e resultados.

## Modos de execução

- Desenvolvimento: sessão em memória e object storage local.
- Distribuído: Redis, BullMQ, storage S3 compatível e worker isolado.

Não existe banco relacional no MVP.

## Legado

`legacy/python` contém a implementação anterior. Ela não é importada nem executada pelos apps
TypeScript e permanece apenas como referência de paridade.
