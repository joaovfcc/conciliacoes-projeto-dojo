# Estado de execução do PRD V2

Atualizado em: 2026-08-04

## Decisões vigentes

- `AD-001` — A estratégia é PDF-first. CSV é uma fonte alternativa com a mesma definição de pronto, nunca um atalho de menor qualidade.
- `AD-002` — O suporte é homologado por instituição, formato, tipo de documento, família de layout e versão. Suportar um layout não implica suportar todos os documentos do banco.
- `AD-003` — Cada processamento possui exatamente uma fonte transacional autoritativa. Movimentos de PDF e CSV nunca são somados ou mesclados.
- `AD-004` — PDF continua no corpus privado para classificação, evidência, identidade, período, saldos e regressão, inclusive quando o CSV for a fonte transacional.
- `AD-005` — Investimentos são informativos e nunca entram no matching automático de conta-corrente.
- `AD-006` — Sugestões 1:N e N:1 ficam desativadas por padrão e não compõem totais conciliados automaticamente.
- `AD-007` — Redis, BullMQ, MinIO e infraestrutura de produção só avançam depois da homologação funcional do core, salvo dependência técnica comprovada em ADR.
- `AD-008` — `v0.2.0-rc.1` representa apenas o Lote 1 PDF. A conclusão do PRD V2 exige o gate global do corpus ou bloqueio externo formal.

## Baseline protegido

- Branch: `codex/pdf-first-v2`
- Commit: `c23754c`
- Lint: aprovado
- Typecheck: aprovado
- Build: aprovado
- TypeScript: 53 testes aprovados; 1 teste de paridade privada ignorado porque o corpus não estava configurado no runner
- Python legado: 83 testes aprovados; cobertura total 87,87%
- Dados privados: `/outputs/`, `/private/`, `/private-corpus/`, `/private-samples/` e `/private-reports/` ignorados pelo Git

## Ciclo atual

`inventário → teste RED → implementação GREEN → refatoração → gates → matriz de progresso → próximo layout`

Em andamento: Fase 0 — inventário reprodutível do corpus privado por pasta ou ZIP.

## Handoff

Ao retomar:

1. consultar `features/pdf-first-csv-alternative/tasks.md`;
2. executar a primeira tarefa não concluída;
3. atualizar este arquivo e as matrizes de suporte ao fim de cada ciclo;
4. nunca marcar um resultado contábil esperado sem oráculo privado revisado.

