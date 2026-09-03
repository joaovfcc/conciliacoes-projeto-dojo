# Especificação — PRD V2 PDF-first com CSV alternativo

## Objetivo

Homologar todo o corpus privado de extratos, mantendo o PDF como fonte primária imediata e construindo uma plataforma CSV segura e equivalente. A aplicação deve conciliar apenas movimentos de conta-corrente que atravessem todos os gates contábeis, sem falsos positivos conhecidos.

## Requisitos funcionais

### `PDFCSV-001` — Inventário integral

O sistema de inventário deve aceitar uma pasta ou um ZIP privado, enumerar recursivamente todos os PDFs, calcular SHA-256 e produzir metadados sanitizados. A matriz deve registrar instituição, tipo de documento, família de layout, quantidade e status sem versionar nomes, contas ou valores financeiros.

### `PDFCSV-002` — Matriz de formatos

Para cada instituição e família, a documentação deve registrar os formatos disponibilizados, o formato transacional preferencial, se PDF é obrigatório e o fallback. Enquanto não houver amostra estruturada real, o status CSV será `NOT_PROVIDED` ou `TECHNICALLY_READY_AWAITING_SAMPLE`, nunca `SUPPORTED`.

### `PDFCSV-003` — Contrato comum de adapter

Todo adapter implementa detecção, parsing e validação; identifica formato, instituição, tipo, família e versão; e produz o mesmo modelo canônico de transação, identidade, período, saldos e proveniência.

### `PDFCSV-004` — Fonte autoritativa única

Os modos suportados são `PDF_PRIMARY`, `CSV_PRIMARY`, `PDF_PRIMARY_CSV_CROSSCHECK` e, futuramente, `CSV_PRIMARY_PDF_EVIDENCE`. Apenas uma fonte fornece movimentos. Fontes nunca são mescladas.

### `PDFCSV-005` — Validação cruzada

Quando PDF e CSV forem fornecidos, divergências de banco, conta, período, saldo, quantidade ou totais devem bloquear a conciliação automática com `SOURCE_CROSSCHECK_FAILED` e detalhes sanitizados para revisão.

### `PDFCSV-006` — Gates comuns

Antes do matching, qualquer fonte atravessa os gates de layout suportado, tipo elegível, identidade, período, completude estrutural, sinais, duplicidades, saldo, mapping e crosscheck. Falha de gate resulta em bloqueio ou `REVIEW_REQUIRED`, nunca em movimentos parciais aceitos silenciosamente.

### `PDFCSV-007` — Segurança e robustez CSV

O leitor CSV deve cobrir UTF-8/UTF-8 BOM e codificações homologadas, delimitadores vírgula e ponto e vírgula, campos entre aspas e quebras de linha, cabeçalhos variáveis declarativos, datas, decimais brasileiros, sinais, colunas separadas de débito/crédito, linhas de saldo, duplicidades, limites de arquivo e proveniência por linha.

### `PDFCSV-008` — Investimentos

Documentos `INVESTMENT_ACTIVITY` e `INVESTMENT_POSITION` devem ser classificados e apresentados como informativos. Eles não exigem mapping contábil e nunca participam do matching de conta-corrente.

### `PDFCSV-009` — Matching conservador

A conciliação automática permanece um-para-um por valor exato, respeitando identidade e gates. Agrupamentos 1:N e N:1 são apenas sugestões, desativados por padrão e excluídos dos totais conciliados.

### `PDFCSV-010` — Homologação por família

Um banco é suportado apenas para cada combinação efetivamente testada de formato, tipo, família e versão. Resultados esperados do corpus privado só podem vir de manifesto/oráculo contábil revisado.

## Adendo de confiabilidade — aprovado em 3 de setembro de 2026

Este adendo não inicia uma segunda reimplementação. Ele encerra lacunas do motor
existente e corrige divergências entre código, testes, matrizes e homologação
contábil. Os estados abaixo nunca são sinônimos:

- `IMPLEMENTED`: há código e teste local para a capacidade;
- `TECHNICALLY_VALIDATED`: os gates técnicos aplicáveis passam;
- `ACCOUNTING_HOMOLOGATED`: há oráculo privado revisado e aprovação contábil;
- `EXTERNALLY_BLOCKED`: falta apenas insumo, credencial ou aprovação externa;
- `NOT_SUPPORTED`: não há adapter ou a fonte não atende os controles exigidos.

### `PDFCSV-011` — Contrato de matching por valor e evidência

- Uma transação de extrato e uma do razão no mesmo escopo lógico, moeda e
  competência podem ser conciliadas automaticamente quando o valor em centavos
  for único nos dois lados. A data é evidência e não bloqueia essa regra.
- Quando o valor se repetir, um documento normalizado, presente e único nos dois
  lados pode desempatar a correspondência. Descrição isolada nunca desempata.
- Quando ainda houver mais de um candidato possível, o motor deve produzir uma
  ambiguidade revisável. Ele nunca escolhe por ordem de arquivo, linha ou data.
- A regra e o rótulo exibidos devem descrever exatamente o critério aplicado.

### `PDFCSV-012` — Escopo lógico e contas físicas

- Uma conta contábil pode receber movimentos de várias contas bancárias físicas
  quando o vínculo tiver sido confirmado para a mesma empresa, filial e
  competência.
- A identidade bancária define o escopo permitido do arquivo. Depois da
  confirmação, ela não pontua nem exclui candidatos daquele escopo lógico.
- O cadastro persistente deve reaplicar vínculos aprovados em novas execuções;
  conflito explícito de banco, agência ou conta continua bloqueando o processo.

### `PDFCSV-013` — Revisão de ambiguidades e agrupamentos

- O resultado deve representar uma ambiguidade como grupo, com todos os
  candidatos, evidências e razão de não decisão.
- Sugestões 1:N e N:1 devem permitir aprovação ou rejeição auditável por pessoa
  autorizada. Até a aprovação, não compõem saldos, totais ou cobertura
  confirmada.

### `PDFCSV-014` — Evidências e indicadores auditáveis

- A interface e o XLSX devem distinguir resultados confirmados, sugeridos,
  ambíguos e pendentes, tanto por linhas quanto por valor.
- Cada item deve preservar arquivo, linha ou página, parser, método de extração
  e controles de integridade.
- O produto deve definir explicitamente se a evidência é apenas metadado ou
  visualização temporária do documento. A opção escolhida deve respeitar a
  política de retenção dos arquivos.

### `PDFCSV-015` — Corpus, formatos e oráculos

- O inventário deve cobrir todos os formatos presentes no corpus privado, não
  somente PDF. Cada XLSX deve ser classificado como razão, fonte transacional ou
  evidência antes de entrar na matriz de disponibilidade.
- Para cada família, o oráculo de parsing deve validar identidade, período,
  contagem, sinais, totais e saldo. O oráculo de conciliação deve validar pares
  esperados, falsos positivos e pendências. Um não substitui o outro.

### `PDFCSV-016` — Gate de confiabilidade e entrega

- Uma alteração não pode avançar se os testes unitários, de integração ou de
  interface em seu escopo estiverem falhando.
- O CI de release deve executar paridade privada obrigatória, cobertura e
  mutation testing. Teste de release ignorado não é resultado verde.
- Nenhuma família recebe `ACCOUNTING_HOMOLOGATED` enquanto houver erro de
  integridade, OCR necessário sem ambiente homologado, oráculo ausente ou falso
  positivo conhecido.

### `PDFCSV-017` — IA somente assistiva

- A IA será avaliada apenas depois do gate determinístico do core. Ela recebe
  candidatos ambíguos e retorna uma sugestão estruturada para revisão humana.
- A IA e o n8n não são dependências do matching, não podem alterar totais sem
  aprovação e não bloqueiam a execução determinística quando indisponíveis.

## Lotes

- Lote 0: inventário completo dos 68 PDFs e disponibilidade de fontes estruturadas.
- Lote 1: Bradesco, BRB, Itaú, Santander e Sofisa; conta-corrente primeiro, investimentos depois.
- Lote 2: ABC, Banco do Brasil, BMG e BMP.
- Lote 3: Bocom, Caixa, Daycoval e Guanabara.
- Lote 4: Paulista, Pine e Vórtx.
- Lote 5: Safra, separado por cada família documental.
- Lote 6: Planner, condicionado à credencial/senha dos documentos protegidos.

Ao concluir um lote, os gates e as matrizes são atualizados e o ciclo segue automaticamente para o próximo trabalho independente.

## Releases e gates

### RC do Lote 1 — `v0.2.0-rc.1`

Pode existir somente quando as nove famílias e vinte PDFs do Lote 1 estiverem homologados por oráculo, os controles de saldo estiverem completos, não houver falsos positivos conhecidos, OCR estiver coberto, mutation/coverage atenderem os gates e nenhum teste de release estiver ignorado.

### Conclusão global — `v0.2.0`

Exige todas as famílias obrigatórias do corpus PDF homologadas ou formalmente bloqueadas por dependência externa, plataforma CSV genérica homologada com fixtures sintéticas, matriz integral atualizada, zero falsos positivos conhecidos e todos os gates de release aprovados. A RC do Lote 1 não conclui o PRD.

## Cobertura mínima

| Área | Linhas | Branches | Mutation |
|---|---:|---:|---:|
| Domínio e matching | 95% | 95% | crítico 90% |
| Detecção e gates | 95% | 90% | crítico 90% |
| Adapters PDF | 90% | 85% | global 80% |
| Infraestrutura CSV | 90% | 85% | global 80% |
| Runtime | 85% | 80% | global 80% |
| Interface | 80% | 75% | global 80% |

## Estados finais

- `CONCLUÍDO`: gate global integral aprovado.
- `BLOQUEADO_EXTERNAMENTE`: restam apenas amostras, credenciais ou oráculos externos, enumerados de forma precisa.
- `FALHA_TÉCNICA`: existe defeito interno sem alternativa segura; deve ser registrado com reprodução.
