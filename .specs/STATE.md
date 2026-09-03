# Estado de execução do PRD V2

Atualizado em: 2026-08-10

## Decisões vigentes

- `AD-001` — A estratégia é PDF-first. CSV é uma fonte alternativa com a mesma definição de pronto, nunca um atalho de menor qualidade.
- `AD-002` — O suporte é homologado por instituição, formato, tipo de documento, família de layout e versão. Suportar um layout não implica suportar todos os documentos do banco.
- `AD-003` — Cada processamento possui exatamente uma fonte transacional autoritativa. Movimentos de PDF e CSV nunca são somados ou mesclados.
- `AD-004` — PDF continua no corpus privado para classificação, evidência, identidade, período, saldos e regressão, inclusive quando o CSV for a fonte transacional.
- `AD-005` — Investimentos são informativos e nunca entram no matching automático de conta-corrente.
- `AD-006` — Sugestões 1:N e N:1 ficam desativadas por padrão e não compõem totais conciliados automaticamente.
- `AD-007` — Redis, BullMQ, MinIO e infraestrutura de produção só avançam depois da homologação funcional do core, salvo dependência técnica comprovada em ADR.
- `AD-008` — `v0.2.0-rc.1` representa apenas o Lote 1 PDF. A conclusão do PRD V2 exige o gate global do corpus ou bloqueio externo formal.
- `AD-009` — A reestruturação usa decimal string no domínio e `Decimal` no PostgreSQL; conversões para `number` não podem cruzar o boundary financeiro.
- `AD-010` — A API V2 aplica autorização por empresa e papel por meio de um contexto de ator desacoplado do provedor corporativo de identidade.
- `AD-011` — Superseded by `AD-013`: a API de sessão anônima permanecia como compatibilidade durante a migração.
- `AD-012` — O gate inicial de mutation testing usa `high=80`, `low=65` e `break=55`, sem excluir regras financeiras; a meta deve subir progressivamente conforme os mutantes sobreviventes forem classificados.
- `AD-013` — A aplicação exige login. O tenant é `ConfigOrganization`; papéis operacionais são concedidos por `ConfigLegalEntity`; `OWNER` administra o tenant. Esta decisão substitui a compatibilidade anônima de `AD-011`.
- `AD-014` — O browser mantém o access JWT apenas em memória. O refresh token opaco é rotativo, persistido somente por hash e enviado em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
- `AD-015` — Sessões autenticadas têm access JWT de 10 minutos, expiração por 8 horas de inatividade e limite absoluto de 24 horas. Resultados autenticados são retidos por um ano; arquivos de entrada continuam temporários.
- `AD-016` — No escopo lógico confirmado, valor em centavos único na competência concilia automaticamente sem bloquear por data. Valor repetido só pode ser desempatado por documento normalizado e único; sem essa evidência, permanece ambíguo. Descrição isolada e ordem de origem nunca decidem um match.

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

Concluído em `T02`: inventário reprodutível por pasta ou ZIP, com trava opcional de quantidade. A
execução privada encontrou 68 PDFs, 68 hashes únicos e persistiu apenas metadados sanitizados.

Concluído em `T03`: catálogo tipado com 36 famílias, 68 PDFs e 18 instituições; invariantes por lote
estão cobertos por teste e a matriz documental foi atualizada.

Estrutura de `T04` concluída: 68 PDFs presentes; OFX, CSV e XLSX bancário estão `NOT_PROVIDED` para
as 18 instituições. Bloqueio externo restante: manifesto privado hash → referência opaca de conta.

Concluído em `T10`: contratos canônicos PDF/CSV, adapter `detect/parse/validate`, transação decimal,
proveniência sanitizada e chave completa de suporte, com validações unitárias.

Concluído em `T11`: registry filtra pelo formato, rejeita chaves completas duplicadas, resolve somente
versões exatas e bloqueia detecção ambígua por limiar/margem.

Concluído em `T12`: gates comuns de suporte, tipo, identidade, período, estrutura, sinais,
duplicidades, saldo, mapping e crosscheck; façade sanitizada converte o modelo legado do parser.

Concluído em `T13`: seleção de fonte autoritativa única e crosscheck PDF/CSV.
Concluído em `T14`: independência do formato com testes unitários.

Concluída a **Fase 2 (Lote 1 PDF)** (`T20` a `T26`): 
- Adapters para Bradesco, BRB, Itaú, Santander e Sofisa.
- Refatoração do `files.ts` mantendo API compatível.
- Gate RC garantindo qualidade na detecção e conversão.

Concluída a **Fase 3 (Plataforma CSV Genérica)** (`T30` a `T33`):
- `csv-reader.ts` e `csv-schema.ts` implementados.
- Testes robustos de detecção de encoding (BOM), delimitadores, injection e normalizadores de datas e valores.
- Matriz de suporte com estado `TECHNICALLY_READY_AWAITING_SAMPLE` para CSV.

Em andamento: ciclo do Lote 3. O adapter textual `BOCOM_CC_ANALITICO` processou o documento privado
com 8 movimentos e sem erro de integridade; o resultado aguarda oráculo contábil. O contrato
`BOCOM_CC_EMPTY` está implementado e testado, mas o documento privado permanece `AWAITING_OCR` e
não expõe período suficiente para inferência automática. As famílias Caixa processaram duas contas
correntes (17 e 3 movimentos) e um fundo (3 evidências informativas), sem erros de integridade e
aguardando oráculos. Daycoval processou 13, 0 e 29 movimentos com todos os controles diários
aprovados. Guanabara processou conta-corrente e conta vinculada com ausência explícita de
movimentos. O build do core agora elimina artefatos compilados órfãos antes do inventário. O gate
técnico do Lote 3 aguarda a suíte integral; depois, a próxima instituição é Paulista no Lote 4.

## Reestruturação modular concluída em 2026-08-09

- domínio organizacional, modelo canônico decimal e persistência PostgreSQL/Prisma implementados;
- pipelines idempotentes de extrato e razão, catálogo de layouts, inspeção e mapeamento implementados;
- matching explicável, exceções, workflow, auditoria, RBAC por empresa, APIs V2 e XLSX implementados;
- gate integral aprovado: lint, typecheck, build, 177 testes TypeScript e 83 testes Python;
- cobertura crítica: 92,68% statements, 84,68% branches, 96,50% functions e 96,13% lines;
- mutation score: 65,42% em 937 mutantes, acima da faixa `low=65` e do bloqueio `break=55`;
- bloqueio externo: o gate `pnpm test:parity:release` exige `PARITY_FIXTURES_DIR` com PDFs privados e
  `statement-parser-manifest.json` homologado. Sem esses dados o teste falha propositalmente.
## Handoff

Ao retomar:

1. consultar `features/pdf-first-csv-alternative/tasks.md`;
2. `T70` foi concluída: valor único em competência e escopo lógico confirmado
   não bloqueia por data; documento normalizado único desempata valor repetido;
   447 testes do core, 67 testes unitários web e 17 componentes web passaram;
3. `T71` foi concluída: `BankLedgerMapping` persiste relações N:1 entre contas
   físicas e contas contábeis, a pré-análise reutiliza somente relações únicas
   e a confirmação bloqueia vínculos persistentes divergentes ou ambíguos;
4. `T72` foi concluída: itens ambíguos compartilham um grupo determinístico com
   todos os candidatos de razão e extrato, motivo e evidência no XLSX; continuam
   exclusivamente em revisão e fora dos totais automáticos;
5. executar `T73`, iniciando por aprovação e rejeição auditável das sugestões
   1:N e N:1, sem alterar totais antes da decisão;
6. atualizar este arquivo e as matrizes de suporte ao fim de cada ciclo;
7. nunca marcar um resultado contábil esperado sem oráculo privado revisado.
