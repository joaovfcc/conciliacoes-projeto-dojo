# Plano de implementação

Cada item usa os critérios e cenários do PRD. O histórico RED/GREEN é registrado nos commits e
na saída dos testes; o status final é mantido aqui.

## T-001 — Fundação técnica e contratos

- ID: T-001
- Descrição: criar pacote, configuração de qualidade, modelos e utilitários seguros.
- Requisito de origem: RNF-003, RNF-005, RNF-006, RNF-009.
- Prioridade: alta. Dependências: nenhuma.
- Critérios de aceitação: instalação local, lint, testes e build reproduzíveis no Windows.
- Cenários de teste: dinheiro brasileiro/internacional, datas, documentos e IDs.
- Arquivos afetados: `pyproject.toml`, `src/conciliacao`, `tests`.
- Riscos: coerção monetária e ambiente corporativo.
- Status: CONCLUIDO

## T-002 — Configuração, descoberta e validações

- ID: T-002
- Descrição: template/configuração XLSX, pastas, nomes, formatos, período, hash e completude.
- Requisito de origem: RF-001, RF-002, RF-003, RF-004, RF-006, RF-015.
- Prioridade: alta. Dependências: T-001.
- Critérios de aceitação: arquivos válidos são tipados; ausentes, vazios, temporários,
  duplicados, corrompidos ou fora do período geram diagnóstico acionável.
- Cenários de teste: nomes válidos/inválidos, hash repetido e configuração incompleta.
- Arquivos afetados: `config.py`, `discovery.py`, fixtures.
- Riscos: layouts reais desconhecidos.
- Status: CONCLUIDO

## T-003 — Adaptadores e normalização

- ID: T-003
- Descrição: ler razão CSV/XLSX e extrato CSV/XLSX/OFX com rastreabilidade por registro.
- Requisito de origem: RF-005, RF-011, RNF-001, RNF-005, RNF-010.
- Prioridade: alta. Dependências: T-001, T-002.
- Critérios de aceitação: importar 100% das linhas válidas, reportar inválidas e preservar
  arquivo/linha; sinais e datas canônicos.
- Cenários de teste: vazio, colunas ausentes, datas/valores inválidos, caracteres especiais,
  débito/crédito e OFX com FITID.
- Arquivos afetados: `adapters`, `normalization.py`, fixtures.
- Riscos: variações de cabeçalhos/OFX.
- Status: CONCLUIDO

## T-004 — Motor conservador de conciliação

- ID: T-004
- Descrição: regras 1–9, ordem, unicidade, divergências e métricas.
- Requisito de origem: RF-007, RF-008, RF-009, RF-010, RNF-006, RNF-007.
- Prioridade: crítica. Dependências: T-001.
- Critérios de aceitação: cada status observável correto, tolerâncias respeitadas, nenhum item
  reutilizado e candidatos múltiplos não escolhidos.
- Cenários de teste: exato, tolerância, documento ausente, valor/data divergente, ausências,
  múltiplos candidatos e duplicidade.
- Arquivos afetados: `reconciliation.py`, `tests/unit`.
- Riscos: falsos positivos; mitigado por prioridade e unicidade.
- Status: CONCLUIDO

## T-005 — Excel e evidências

- ID: T-005
- Descrição: gerar as sete abas obrigatórias, resumo derivado e campos de análise humana.
- Requisito de origem: RF-010, RF-011, RF-012, RNF-001, RNF-007.
- Prioridade: alta. Dependências: T-003, T-004.
- Critérios de aceitação: abas/cabeçalhos definidos, totais reconciliam, filtros, painéis e
  formatação legíveis, valores e origens presentes.
- Cenários de teste: relatório misto, listas vazias, formula injection e reabertura do XLSX.
- Arquivos afetados: `reporting.py`, `tests/integration`.
- Riscos: resumo inconsistente; mitigado por derivação única.
- Status: CONCLUIDO

## T-006 — Orquestração, log, arquivamento e reprocessamento

- ID: T-006
- Descrição: execução integral, recuperação parcial, manifesto de hashes e CLI/BAT.
- Requisito de origem: RF-013, RF-014, RF-016, RNF-002, RNF-004, RNF-010.
- Prioridade: alta. Dependências: T-002 a T-005.
- Critérios de aceitação: fluxo completo gera relatório/log, move válidos/rejeitados, não
  sobrescreve output e exige flag para hash já visto; crítico não move entradas.
- Cenários de teste: primeira execução, parcial, repetição e falha de configuração.
- Arquivos afetados: `processing.py`, `cli.py`, BAT, integração/E2E.
- Riscos: falha após movimento; mitigado por gerar output antes de arquivar.
- Status: CONCLUIDO

## T-007 — Documentação, segurança e auditoria final

- ID: T-007
- Descrição: manuais, layouts, rastreabilidade, dependências e validação limpa.
- Requisito de origem: todos os RF/RNF e critérios de aceite 1–14.
- Prioridade: alta. Dependências: T-001 a T-006.
- Critérios de aceitação: README executável por terceiro, matriz completa, testes/lint/build
  verdes e varredura sem segredo.
- Cenários de teste: instalação limpa e cenário mensal fictício.
- Arquivos afetados: `README.md`, `docs`, CI.
- Riscos: aprovação contábil depende do piloto externo.
- Status: CONCLUIDO

## Adendo PDF — backlog TDD

Todos os itens abaixo foram executados com teste falhando (RED), menor implementação correta
(GREEN), refatoração e suíte completa. Prioridade é alta; `PDF-016` e `PDF-017` são críticas.
Risco comum: variações de layouts reais; mitigação: parser conservador e fixtures anonimizadas.

| ID | Entrega e requisito | Dependências | Aceite e testes | Arquivos principais | Status |
|---|---|---|---|---|---|
| PDF-001 | Modelo normalizado de extrato | T-001 | `Decimal`, tipos, origem e confiança cobertos em unitário | `models.py` | CONCLUÍDO |
| PDF-002 | Validação de arquivos PDF | PDF-001 | assinatura, extensão, vazio, proteção, corrupção, tamanho e páginas | `extraction.py`, integração | CONCLUÍDO |
| PDF-003 | Extração de texto | PDF-002 | todas as páginas pesquisáveis extraídas por pypdf | `extraction.py`, fixtures text-based | CONCLUÍDO |
| PDF-004 | Detecção de digitalizados | PDF-003 | página abaixo do mínimo seleciona OCR, sem OCR desnecessário | `extraction.py`, fixtures scanned | CONCLUÍDO |
| PDF-005 | Adaptador de OCR | PDF-004 | protocolo substituível, Tesseract isolado, timeout e confiança | `extraction.py`, testes com adapter | CONCLUÍDO |
| PDF-006 | Identificação de layout | PDF-003 | Itaú reconhecido; desconhecido rejeitado sem lançamentos | `parsers.py` | CONCLUÍDO |
| PDF-007 | Parser genérico | PDF-006 | somente tabela segura e explicitamente reconhecível | `parsers.py` | CONCLUÍDO |
| PDF-008 | Parser específico | PDF-006 | `ITAU_TEXTO_V1` com cabeçalho e movimentos sintéticos | `parsers.py`, fixture Itaú | CONCLUÍDO |
| PDF-009 | Datas e valores | PDF-001 | datas BR/sem ano seguro, milhar, vírgula e sinal posterior | `parsers.py`, unitários | CONCLUÍDO |
| PDF-010 | Crédito e débito | PDF-009 | sinais e marcadores C/D/CR/DB, sem valor absoluto | `parsers.py`, unitários | CONCLUÍDO |
| PDF-011 | Descrição multilinha | PDF-008 | continuação vira um movimento; quebra de página preservada | `parsers.py`, unitários | CONCLUÍDO |
| PDF-012 | Cabeçalhos e rodapés | PDF-008 | repetição multipágina não vira movimento | `parsers.py`, integração | CONCLUÍDO |
| PDF-013 | Duplicidades | PDF-009 | ID estável e alerta sem duplicar importação | `parsers.py`, unitários | CONCLUÍDO |
| PDF-014 | Validação de saldo | PDF-009 | saldo consistente e divergência evidenciada | `parsers.py`, unitários | CONCLUÍDO |
| PDF-015 | Relatório de importação | PDF-002..014 | páginas, método, válidos, rejeitados, alertas, erros e duração | `service.py`, `reporting.py` | CONCLUÍDO |
| PDF-016 | Integração com conciliação | PDF-015 | `ReadResult` comum, motor sem dependência de pypdf | `adapters.py`, `processing.py`, E2E | CONCLUÍDO |
| PDF-017 | Evidência com página | PDF-016 | divergência exibe arquivo, página, trecho, parser e método | `reporting.py`, E2E | CONCLUÍDO |
| PDF-018 | Testes unitários | PDF-001..014 | normalização, detector, parser e validadores verdes | `tests/unit/test_pdf_*` | CONCLUÍDO |
| PDF-019 | Testes de integração | PDF-002..015 | PDFs estruturais reais, páginas, OCR e erros | `tests/integration/test_pdf_statements.py` | CONCLUÍDO |
| PDF-020 | Teste end-to-end | PDF-016..019 | PDF até Excel com divergência rastreável | `tests/e2e/test_processing.py` | CONCLUÍDO |
| PDF-021 | Documentação | PDF-001..020 | README, arquitetura, decisões, layouts e matriz atualizados | `README.md`, `docs/` | CONCLUÍDO |

Observação de implantação: o adaptador OCR está integrado e formalmente desabilitado por padrão.
O binário Tesseract não está presente neste ambiente de build; sua homologação deve ocorrer na
máquina corporativa após instalação, sem alterar o contrato ou o fluxo de conciliação.
