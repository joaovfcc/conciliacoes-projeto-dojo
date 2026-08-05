# Tarefas — execução contínua

Cada tarefa usa RED → GREEN → refatoração → gates → commit atômico. `[x]` significa código e testes concluídos; bloqueios externos não contam como conclusão.

## Fase 0 — baseline e inventário

- [x] `T00` Criar branch dedicada e proteger dados/artefatos privados no `.gitignore`.
- [x] `T01` Capturar baseline da migração TypeScript e executar lint, typecheck, build e testes.
- [x] `T02` Aceitar pasta ou ZIP no inventário, enumerar PDFs recursivamente, calcular hashes e não expor nomes privados no relatório.
- [x] `T03` Gerar a matriz completa instituição × documento × família × quantidade × status para os 68 PDFs.
- [ ] `T04` Gerar a matriz instituição × conta anonimizada × formatos × preferência × PDF obrigatório × fallback; estrutura e formatos concluídos, dimensão conta em `AWAITING_PRIVATE_ACCOUNT_MANIFEST`.
- [x] `T05` Atualizar `PRD_V2_SUPPORT_MATRIX.md`, `PRD_V2_PROGRESS.md` e este estado com o resultado reprodutível.

## Fase 1 — núcleo comum PDF/CSV

- [x] `T10` Criar contratos canônicos de formato, adapter, proveniência e issues; seleção de fonte autoritativa segue em `T13`.
- [x] `T11` Implementar registry pela chave completa e detecção fechada em ambiguidade.
- [ ] `T12` Implementar pipeline comum de gates e compatibilidade com `parseStatement`/preflight atuais.
- [ ] `T13` Implementar seleção de fonte única e `SOURCE_CROSSCHECK_FAILED`.
- [ ] `T14` Provar por testes que matching, relatório e exportação não dependem de PDF ou CSV.

## Fase 2 — Lote 1 PDF

- [ ] `T20` Bradesco conta-corrente: adapter versionado, saldo, duplicidades, conta sem movimentos e corpus privado.
- [ ] `T21` BRB conta-corrente: adapter versionado e oráculo dos oito movimentos.
- [ ] `T22` Itaú conta-corrente: texto/OCR, saldo e evidência.
- [ ] `T23` Santander conta-corrente: adapter, sinais e saldo.
- [ ] `T24` Sofisa conta-corrente: adapter, saldos e cinco contas.
- [ ] `T25` Investimentos Bradesco/Itaú/Santander/Sofisa: classificação informativa e exclusão absoluta do matching.
- [ ] `T26` Executar gate RC do Lote 1; não criar tag se qualquer condição falhar.

## Fase 3 — plataforma CSV genérica

- [ ] `T30` Leitor seguro: encoding/BOM, delimitadores, aspas, quebras, limites e erros estáveis.
- [ ] `T31` Schema declarativo: aliases, datas, decimal brasileiro, sinais, débito/crédito, saldo e proveniência.
- [ ] `T32` Fixtures sintéticas brasileiras e testes adversariais/duplicidades/formula injection.
- [ ] `T33` Estado `TECHNICALLY_READY_AWAITING_SAMPLE`; nenhum banco marcado suportado sem amostra real.

## Fases 4–5 — corpus restante e CSV real

- [ ] `T40` Lote 2 PDF: ABC, Banco do Brasil, BMG e BMP.
- [ ] `T41` Lote 3 PDF: Bocom, Caixa, Daycoval e Guanabara.
- [ ] `T42` Lote 4 PDF: Paulista, Pine e Vórtx.
- [ ] `T43` Lote 5 PDF: cada família Safra separadamente.
- [ ] `T44` Lote 6 PDF: Planner; marcar credencial externa quando aplicável.
- [ ] `T45` Para cada amostra CSV real, criar adapter/família, oráculo, crosscheck e atualizar matriz.

## Fase 6 — matching, revisão e relatórios

- [ ] `T50` Completar prevenção de falsos positivos, limites, duplicidades e invariantes um-para-um.
- [ ] `T51` Manter 1:N/N:1 somente como sugestões desativadas e fora dos totais.
- [ ] `T52` Expor formato, adapter, versão, gates, saldos e crosscheck em UI/XLSX sem dados sensíveis em telemetria.

## Fase 7 — infraestrutura e release global

- [ ] `T60` Registrar ADR comparando runtime simples com Redis/BullMQ/MinIO e compatibilidade de hospedagem.
- [ ] `T61` Implementar apenas a infraestrutura justificada depois da homologação funcional do core.
- [ ] `T62` Executar lint, typecheck, builds, todas as suítes, coverage, mutation e paridade de release sem skips.
- [ ] `T63` Atualizar matriz global e classificar o resultado como `CONCLUÍDO`, `BLOQUEADO_EXTERNAMENTE` ou `FALHA_TÉCNICA`.

## Matriz de cobertura de requisitos

| Requisito | Tarefas |
|---|---|
| `PDFCSV-001` | T02–T05 |
| `PDFCSV-002` | T04, T33, T45 |
| `PDFCSV-003` | T10–T12, T20–T25, T30–T31 |
| `PDFCSV-004` | T13–T14 |
| `PDFCSV-005` | T13, T45, T52 |
| `PDFCSV-006` | T12, T20–T25, T50 |
| `PDFCSV-007` | T30–T33 |
| `PDFCSV-008` | T25, T52 |
| `PDFCSV-009` | T50–T51 |
| `PDFCSV-010` | T03–T05, T20–T26, T40–T45, T62–T63 |
