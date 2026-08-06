# PRD — Suporte Nativo e Robusto a Arquivos XLSX, XLS e XLSM

## 1. Informações do documento

| Campo                        | Valor                                                |
| ---------------------------- | ---------------------------------------------------- |
| Produto                      | Motor de Conciliação Contábil                        |
| Componente                   | `@conciliacao/core`                                  |
| Funcionalidade               | Extração de dados tabulares de planilhas bancárias   |
| Status                       | Pronto para implementação                            |
| Prioridade                   | Alta                                                 |
| Estratégia                   | XLSX/CSV como fontes transacionais estruturadas      |
| Escopo inicial               | Extratos bancários e arquivos tabulares equivalentes |
| Stack principal              | TypeScript, Node.js, pnpm e SheetJS                  |
| Responsável pela homologação | Time responsável pela conciliação e corpus bancário  |

---

# 2. Resumo executivo

O motor de conciliação atualmente possui suporte consolidado a arquivos CSV e mecanismos de leitura de planilhas baseados em bibliotecas que não demonstraram estabilidade suficiente diante de arquivos bancários reais.

Durante os testes, a biblioteca utilizada anteriormente para leitura de Excel apresentou falhas fatais em arquivos que continham metadados, estruturas internas incomuns ou conteúdo proveniente de sistemas bancários.

A nova diretriz de negócio estabelece que arquivos XLSX devem ser tratados como uma das fontes transacionais prioritárias, juntamente com CSV, devido à maior precisão estrutural em comparação com a extração de dados de PDF.

Este projeto implementará um leitor nativo e robusto para:

* `.xlsx`;
* `.xls`;
* `.xlsm`.

O SheetJS será utilizado como mecanismo principal de leitura de planilhas.

O conteúdo extraído será convertido para um modelo tabular genérico, compartilhado por CSV e Excel. Após essa conversão, o arquivo seguirá pelo mesmo mecanismo já existente de:

* identificação de cabeçalhos;
* mapeamento de colunas por aliases;
* normalização de datas;
* normalização de valores;
* proteção contra fórmulas e conteúdo inesperado;
* classificação dos lançamentos;
* conciliação.

A solução também deverá detectar automaticamente qual aba contém os lançamentos financeiros, evitando a limitação de exigir que o extrato esteja obrigatoriamente na primeira aba.

---

# 3. Contexto do problema

## 3.1 Cenário atual

O sistema possui um fluxo de processamento voltado principalmente para:

* extratos em PDF;
* arquivos CSV;
* razão contábil;
* documentos tabulares auxiliares.

A estratégia PDF-first foi necessária porque os arquivos disponíveis inicialmente eram predominantemente PDFs.

Entretanto, a extração de documentos PDF apresenta desafios relevantes:

* variação visual entre bancos;
* ausência de estrutura tabular real;
* linhas quebradas;
* históricos distribuídos em várias linhas;
* dificuldade de diferenciação entre débito, crédito e saldo;
* dependência de posição visual;
* divergências entre versões de um mesmo banco;
* maior esforço de manutenção dos parsers.

Arquivos XLSX e CSV possuem estrutura mais adequada para a extração transacional, pois disponibilizam diretamente:

* células;
* linhas;
* colunas;
* tipos de valores;
* separação entre campos;
* datas;
* valores monetários;
* saldos;
* históricos.

Por isso, quando disponíveis, XLSX e CSV devem possuir prioridade sobre PDF como fonte de lançamentos.

## 3.2 Problema técnico identificado

A solução de leitura anterior utilizava o ExcelJS.

Embora o ExcelJS seja adequado para criação, edição e formatação de planilhas, foram identificados problemas durante a leitura de arquivos bancários reais, principalmente em planilhas contendo:

* metadados incomuns;
* extensões internas específicas;
* arquivos gerados por sistemas legados;
* estruturas XML fora do padrão esperado pela biblioteca;
* planilhas habilitadas para macros;
* objetos internos que não são relevantes para a extração.

Essas situações podem provocar falhas de leitura ou interrupções do processo.

## 3.3 Oportunidade

Substituir o ExcelJS apenas no fluxo de leitura permite:

* aumentar a estabilidade da importação;
* reaproveitar o pipeline de CSV;
* reduzir a complexidade dos parsers de PDF;
* aumentar a precisão da conciliação;
* preservar o ExcelJS em funcionalidades onde ele é mais adequado, como exportação e geração de relatórios.

---

# 4. Objetivo do produto

Implementar suporte robusto, seguro, auditável e extensível à leitura de arquivos XLSX, XLS e XLSM no motor de conciliação.

O leitor deverá transformar planilhas bancárias em uma representação tabular padronizada, compatível com o fluxo já utilizado para arquivos CSV.

A implementação deverá:

1. Ler planilhas sem depender do ExcelJS.
2. Não executar macros.
3. Identificar automaticamente a aba com os lançamentos.
4. Preservar a referência da linha e da aba de origem.
5. Normalizar células sem perder informações semanticamente relevantes.
6. Reaproveitar o mecanismo atual de detecção de schema.
7. Tratar arquivos inválidos sem interromper a aplicação.
8. Produzir erros e avisos compreensíveis.
9. Ser validada com arquivos reais do corpus bancário.
10. Não gerar regressões no suporte a CSV, PDF ou exportações existentes.

---

# 5. Definição de sucesso

A funcionalidade será considerada concluída quando:

* arquivos `.xlsx`, `.xls` e `.xlsm` puderem ser processados pelo motor;
* o ExcelJS não for utilizado no fluxo de leitura de arquivos de entrada;
* o SheetJS for utilizado como parser principal de planilhas;
* macros e scripts nunca forem executados;
* a aba transacional for identificada automaticamente;
* os dados forem convertidos para um modelo tabular comum;
* o pipeline existente de detecção de colunas puder ser reaproveitado;
* datas e valores monetários forem interpretados corretamente;
* os arquivos bancários reais anteriormente problemáticos forem processados sem crash;
* a suíte atual continuar passando;
* os novos testes cobrirem casos normais e casos de falha;
* o sistema gerar evidências com aba e número da linha original;
* o suporte estiver representado corretamente na matriz de formatos.

---

# 6. Escopo

## 6.1 Dentro do escopo

* Leitura de arquivos `.xlsx`.
* Leitura de arquivos `.xls`.
* Leitura de arquivos `.xlsm`.
* Utilização de SheetJS para leitura.
* Detecção automática da aba transacional.
* Conversão das células para modelo tabular comum.
* Preservação de metadados mínimos de origem.
* Identificação do número original da linha.
* Reaproveitamento do detector de schema utilizado pelo CSV.
* Normalização de datas.
* Normalização de valores monetários.
* Tratamento de células vazias.
* Tratamento de fórmulas com resultado armazenado.
* Identificação de fórmulas sem resultado.
* Limitação de tamanho, linhas, colunas e abas.
* Geração de warnings.
* Geração de erros tipados.
* Testes unitários.
* Testes de integração.
* Testes com corpus bancário real ou sanitizado.
* Atualização da matriz de suporte.
* Atualização da documentação técnica.

## 6.2 Fora do escopo

* Execução de macros VBA.
* Edição de arquivos XLSX recebidos.
* Recalcular fórmulas.
* Alterar células da planilha de origem.
* Preservar cores, fontes, bordas ou imagens.
* Interpretar gráficos.
* Interpretar tabelas dinâmicas.
* Interpretar objetos incorporados.
* Extrair imagens da planilha.
* Processar planilhas protegidas por senha sem que a senha seja fornecida.
* Criar um editor de mapeamento visual nesta fase.
* Substituir o suporte a PDF.
* Garantir suporte irrestrito a qualquer planilha existente.
* Utilizar IA para decidir o conteúdo das células nesta etapa.

---

# 7. Princípios arquiteturais

## 7.1 Modelo tabular unificado

CSV e Excel devem convergir para uma mesma estrutura intermediária.

O restante do domínio não deve precisar saber se os dados vieram de:

* CSV;
* XLSX;
* XLS;
* XLSM.

O pipeline deverá trabalhar com o conceito de documento tabular.

Fluxo esperado:

```text
Arquivo de entrada
        │
        ▼
Identificação do formato
        │
        ├── CSV ───────────────┐
        │                      │
        └── XLS/XLSX/XLSM ─────┤
                               ▼
                    Documento tabular comum
                               │
                               ▼
                    Detecção de cabeçalho
                               │
                               ▼
                    Mapeamento por aliases
                               │
                               ▼
                    Normalização de campos
                               │
                               ▼
                    Lançamentos financeiros
                               │
                               ▼
                          Conciliação
```

## 7.2 Separação entre leitura e interpretação

O leitor de planilhas não será responsável por determinar o significado final de todas as colunas.

Responsabilidades do leitor:

* abrir o arquivo;
* listar abas;
* selecionar a aba candidata;
* extrair as células;
* preservar referências;
* gerar warnings técnicos.

Responsabilidades do mecanismo de schema:

* identificar a linha de cabeçalho;
* reconhecer a coluna de data;
* reconhecer histórico;
* reconhecer valor;
* reconhecer débito;
* reconhecer crédito;
* reconhecer saldo;
* reconhecer documento.

## 7.3 Falha controlada

Nenhum arquivo inválido poderá derrubar o processo completo da aplicação.

Todo erro deverá ser:

* capturado;
* classificado;
* transformado em erro de domínio;
* associado ao arquivo correspondente;
* incluído no resultado do processamento.

## 7.4 Auditabilidade

Todo lançamento extraído deverá preservar evidências suficientes para rastrear sua origem.

No mínimo:

* nome do arquivo;
* extensão;
* nome da aba;
* número da linha;
* valores originais da linha;
* warnings associados.

---

# 8. Decisões técnicas

## 8.1 Biblioteca de leitura

O SheetJS será utilizado como parser principal para:

* `.xlsx`;
* `.xls`;
* `.xlsm`.

O ExcelJS poderá continuar no projeto quando necessário para:

* criação de planilhas;
* geração de relatórios;
* formatação de arquivos de saída;
* exportação de resultados.

O ExcelJS não deverá ser utilizado no fluxo principal de leitura das planilhas bancárias.

## 8.2 Dependência

A dependência deverá:

* utilizar uma versão explicitamente fixada;
* ser registrada no `pnpm-lock.yaml`;
* não utilizar faixa aberta de versão;
* ser instalada a partir da distribuição oficial aprovada pelo projeto;
* passar por verificação de licença e segurança;
* ser atualizada apenas por mudança controlada.

Exemplo conceitual:

```json
{
  "dependencies": {
    "xlsx": "<versão-fixada-e-aprovada>"
  }
}
```

A versão exata deverá ser confirmada no momento da implementação com base na distribuição oficial adotada pelo projeto.

## 8.3 Suporte a macros

Arquivos `.xlsm` deverão ser aceitos como documentos tabulares.

As macros não deverão ser:

* carregadas desnecessariamente;
* interpretadas;
* executadas;
* preservadas em arquivos de saída;
* utilizadas para calcular valores.

A aplicação deverá ler apenas o conteúdo das células necessário para extração.

## 8.4 Fórmulas

O sistema não será um motor de cálculo de Excel.

Regras:

* se a célula possuir fórmula e resultado armazenado, utilizar o resultado;
* se a célula possuir fórmula sem resultado disponível, gerar warning;
* não executar a fórmula;
* não recalcular o workbook;
* não confiar na fórmula como código;
* preservar evidência de que a célula possuía fórmula, quando possível.

---

# 9. Modelo de dados

## 9.1 Substituição de nomenclatura

A interface `ExtractedCsvRow` não deve continuar sendo usada como modelo genérico, pois seu nome cria acoplamento conceitual com CSV.

Novo modelo sugerido:

```ts
export type TabularFileFormat =
  | "csv"
  | "xlsx"
  | "xls"
  | "xlsm";

export interface ExtractedTabularCell {
  columnIndex: number;
  rawValue: unknown;
  displayValue: string;
  formula?: string;
}

export interface ExtractedTabularRow {
  rowNumber: number;
  cells: ExtractedTabularCell[];
}

export interface ExtractedTabularDocument {
  format: TabularFileFormat;
  fileName?: string;
  sheetName?: string;
  rows: ExtractedTabularRow[];
  warnings: TabularWarning[];
  metadata: TabularDocumentMetadata;
}

export interface TabularDocumentMetadata {
  totalSheets?: number;
  selectedSheetIndex?: number;
  selectedSheetName?: string;
  totalRows: number;
  totalColumns: number;
  hasFormulas: boolean;
  hasMacros?: boolean;
}

export interface TabularWarning {
  code: string;
  message: string;
  sheetName?: string;
  rowNumber?: number;
  columnIndex?: number;
}
```

## 9.2 Compatibilidade transitória

Caso a mudança imediata de todas as interfaces gere impacto excessivo, poderá ser utilizado um alias temporário:

```ts
/**
 * @deprecated Use ExtractedTabularRow.
 */
export type ExtractedCsvRow = ExtractedTabularRow;
```

Esse alias deverá ser removido após a migração dos consumidores.

---

# 10. Organização de arquivos

Estrutura recomendada:

```text
packages/core/src/tabular/
├── index.ts
├── tabular-types.ts
├── tabular-errors.ts
├── tabular-reader.ts
├── csv-reader.ts
├── spreadsheet-reader.ts
├── sheet-selector.ts
├── sheet-scoring.ts
├── cell-normalizer.ts
├── workbook-validator.ts
└── tabular-limits.ts
```

Arquivos de teste:

```text
packages/core/src/tabular/__tests__/
├── spreadsheet-reader.test.ts
├── sheet-selector.test.ts
├── sheet-scoring.test.ts
├── cell-normalizer.test.ts
├── workbook-validator.test.ts
└── tabular-reader.integration.test.ts
```

Fixtures:

```text
packages/core/test/fixtures/spreadsheets/
├── basic.xlsx
├── legacy.xls
├── macro-enabled.xlsm
├── multiple-sheets.xlsx
├── title-before-header.xlsx
├── dates-as-serial.xlsx
├── dates-as-text.xlsx
├── formulas.xlsx
├── corrupted.xlsx
├── empty.xlsx
├── hidden-sheet.xlsx
└── bank-sanitized/
```

---

# 11. Requisitos funcionais

## RF-001 — Identificação do formato

O sistema deverá identificar o parser adequado por meio da extensão normalizada.

Extensões aceitas:

```ts
const SUPPORTED_TABULAR_EXTENSIONS = [
  ".csv",
  ".xlsx",
  ".xls",
  ".xlsm",
] as const;
```

O sistema deverá rejeitar extensões não suportadas com erro tipado.

## RF-002 — Leitura de XLSX

O sistema deverá abrir arquivos `.xlsx` e extrair suas linhas e células.

## RF-003 — Leitura de XLS

O sistema deverá abrir arquivos `.xls` legados e convertê-los para o mesmo modelo tabular.

## RF-004 — Leitura de XLSM

O sistema deverá abrir arquivos `.xlsm`, ignorando macros e extraindo somente os dados das células.

## RF-005 — Listagem de abas

O leitor deverá identificar:

* quantidade de abas;
* nomes das abas;
* ordem das abas;
* abas visíveis;
* abas ocultas, quando essa informação estiver disponível.

## RF-006 — Seleção automática da aba

O sistema não deverá assumir que a primeira aba contém o extrato.

Cada aba candidata deverá receber uma pontuação baseada na presença de aliases transacionais.

Aliases iniciais sugeridos:

### Data

* data;
* data lançamento;
* data do lançamento;
* dt lançamento;
* movimento;
* data movimento;
* lançamento em;
* contabilização.

### Histórico

* histórico;
* historico;
* descrição;
* descricao;
* lançamento;
* lancamento;
* detalhe;
* complemento;
* narrativa.

### Documento

* documento;
* doc;
* número documento;
* numero documento;
* referência;
* referencia;
* id transação;
* id transacao.

### Valor

* valor;
* valor lançamento;
* valor do lançamento;
* valor movimento;
* montante.

### Débito

* débito;
* debito;
* saída;
* saida;
* valor débito;
* valor debito.

### Crédito

* crédito;
* credito;
* entrada;
* valor crédito;
* valor credito.

### Saldo

* saldo;
* saldo atual;
* saldo disponível;
* saldo disponivel;
* saldo após;
* saldo apos.

## RF-007 — Critério de pontuação

A pontuação deverá considerar:

* quantidade de aliases reconhecidos;
* presença de coluna de data;
* presença de valor ou combinação débito/crédito;
* quantidade de linhas não vazias;
* densidade de células preenchidas;
* presença de cabeçalho provável;
* penalidade para abas muito pequenas;
* penalidade para abas apenas informativas;
* penalidade para abas ocultas.

Exemplo conceitual:

```ts
score =
  dateColumnScore +
  amountColumnScore +
  descriptionColumnScore +
  documentColumnScore +
  dataDensityScore -
  hiddenSheetPenalty -
  emptySheetPenalty;
```

## RF-008 — Fallback de seleção

Quando nenhuma aba atingir a pontuação mínima:

1. selecionar a primeira aba visível e não vazia;
2. registrar warning de baixa confiança;
3. continuar somente se houver estrutura tabular mínima;
4. falhar de maneira controlada caso não existam dados utilizáveis.

## RF-009 — Extração das células

O leitor deverá preservar:

* valor bruto;
* valor de exibição;
* índice da coluna;
* número da linha;
* fórmula, quando existir.

## RF-010 — Linhas vazias

Linhas totalmente vazias deverão ser ignoradas.

Linhas parcialmente preenchidas deverão ser preservadas.

## RF-011 — Células ausentes

Células ausentes entre duas colunas preenchidas deverão ser representadas por valor vazio para preservar o alinhamento das colunas.

## RF-012 — Cabeçalhos após apresentação

O sistema deverá permitir que o cabeçalho esteja após linhas iniciais contendo:

* nome do banco;
* agência;
* conta;
* período;
* nome do cliente;
* data de emissão;
* título do relatório.

A detecção de schema deverá examinar uma janela inicial configurável de linhas.

Exemplo:

```ts
const HEADER_SCAN_MAX_ROWS = 50;
```

## RF-013 — Datas

O normalizador deverá reconhecer:

* objetos `Date`;
* número serial do Excel;
* `dd/MM/yyyy`;
* `dd/MM/yy`;
* `yyyy-MM-dd`;
* `dd-MM-yyyy`;
* datas com horário;
* datas armazenadas como texto.

O sistema deverá evitar alterar a data contábil por conversão indevida de timezone.

## RF-014 — Valores monetários

O normalizador deverá reconhecer:

* `1.234,56`;
* `1234,56`;
* `1,234.56`;
* `1234.56`;
* `R$ 1.234,56`;
* `-1.234,56`;
* `(1.234,56)`;
* valores numéricos nativos;
* débito e crédito em colunas separadas.

## RF-015 — Zeros à esquerda

Quando uma célula representar identificador ou documento, o valor de exibição deverá ser preservado.

Exemplo:

```text
001234
```

Não deverá ser convertido automaticamente para:

```text
1234
```

## RF-016 — Fórmulas

Células com fórmula deverão utilizar o resultado armazenado, quando disponível.

Na ausência de resultado, deverá ser gerado warning:

```text
FORMULA_WITHOUT_CACHED_VALUE
```

## RF-017 — Arquivos corrompidos

Arquivos corrompidos deverão produzir erro de domínio e não poderão encerrar o processo completo.

## RF-018 — Arquivos protegidos

Planilhas criptografadas ou protegidas de forma incompatível deverão gerar erro específico.

Exemplo:

```text
ENCRYPTED_SPREADSHEET_NOT_SUPPORTED
```

## RF-019 — Evidência de origem

Cada lançamento extraído deverá possuir referência para:

* arquivo;
* aba;
* linha;
* conteúdo original da linha.

## RF-020 — Integração com o fluxo existente

Após a extração, as linhas deverão seguir para o mecanismo atual de:

* detecção de schema;
* aliases;
* normalização;
* classificação;
* conciliação.

---

# 12. Requisitos não funcionais

## RNF-001 — Estabilidade

Um arquivo inválido não poderá provocar crash fatal da aplicação.

## RNF-002 — Segurança

A aplicação não poderá executar:

* macros;
* fórmulas;
* scripts;
* objetos incorporados;
* conteúdo externo do workbook.

## RNF-003 — Desempenho

O processamento deverá utilizar limites configuráveis de:

* tamanho do arquivo;
* quantidade de abas;
* quantidade de linhas;
* quantidade de colunas;
* quantidade total de células.

Valores iniciais sugeridos:

```ts
export const DEFAULT_TABULAR_LIMITS = {
  maxFileSizeBytes: 25 * 1024 * 1024,
  maxSheets: 20,
  maxRows: 100_000,
  maxColumns: 100,
  maxCells: 2_000_000,
  headerScanRows: 50,
};
```

Esses valores deverão ser ajustáveis por configuração.

## RNF-004 — Memória

Como o workbook poderá ser carregado em memória, o sistema deverá rejeitar arquivos acima dos limites antes do parsing completo, sempre que possível.

## RNF-005 — Observabilidade

O processamento deverá registrar:

* formato;
* tamanho do arquivo;
* quantidade de abas;
* aba selecionada;
* pontuação da aba;
* quantidade de linhas extraídas;
* duração do parsing;
* warnings;
* erro final, quando houver.

Dados financeiros não deverão ser registrados integralmente em logs de produção.

## RNF-006 — Compatibilidade

A alteração não poderá quebrar:

* leitura de CSV;
* leitura de PDF;
* exportação existente;
* contratos públicos do pacote sem estratégia de migração;
* suíte de testes atual.

## RNF-007 — Reprodutibilidade

A dependência deverá permanecer fixada no lockfile.

## RNF-008 — Testabilidade

Todos os componentes críticos deverão permitir teste isolado sem acesso ao sistema de arquivos.

O parser principal deverá aceitar `Buffer`.

---

# 13. API proposta

## 13.1 Leitor genérico

```ts
export interface ParseTabularFileInput {
  buffer: Buffer;
  extension: string;
  fileName?: string;
  limits?: Partial<TabularLimits>;
}

export async function parseTabularFile(
  input: ParseTabularFileInput,
): Promise<ExtractedTabularDocument>;
```

## 13.2 Leitor de planilhas

```ts
export interface ParseSpreadsheetInput {
  buffer: Buffer;
  format: "xlsx" | "xls" | "xlsm";
  fileName?: string;
  limits?: Partial<TabularLimits>;
}

export function parseSpreadsheet(
  input: ParseSpreadsheetInput,
): ExtractedTabularDocument;
```

## 13.3 Seleção de aba

```ts
export interface SheetCandidate {
  index: number;
  name: string;
  hidden: boolean;
  score: number;
  matchedAliases: string[];
  nonEmptyRows: number;
  nonEmptyCells: number;
}

export interface SheetSelectionResult {
  selected: SheetCandidate;
  candidates: SheetCandidate[];
  confidence: "high" | "medium" | "low";
  warnings: TabularWarning[];
}
```

---

# 14. Fluxo detalhado de processamento

## Etapa 1 — Validação inicial

1. Receber `Buffer`, extensão e nome do arquivo.
2. Normalizar a extensão.
3. Verificar se a extensão é suportada.
4. Validar tamanho máximo.
5. Rejeitar buffer vazio.
6. Encaminhar ao parser correspondente.

## Etapa 2 — Leitura do workbook

1. Abrir o workbook com SheetJS.
2. Não habilitar leitura de VBA.
3. Não executar fórmulas.
4. Validar a existência de abas.
5. Validar limite de abas.
6. Obter metadados básicos.

## Etapa 3 — Pré-análise das abas

1. Ler uma janela limitada das primeiras linhas.
2. Converter as células para valores de exibição.
3. Normalizar temporariamente o texto dos cabeçalhos.
4. Calcular a pontuação de cada aba.
5. Ignorar ou penalizar abas vazias.
6. Penalizar abas ocultas.
7. Selecionar a melhor candidata.

## Etapa 4 — Leitura integral da aba selecionada

1. Converter a aba para matriz.
2. Preservar células vazias intermediárias.
3. Remover linhas totalmente vazias.
4. Validar limites de linhas e colunas.
5. Criar `ExtractedTabularRow`.
6. Registrar número original da linha.
7. Preservar valor bruto e valor exibido.

## Etapa 5 — Detecção de schema

1. Enviar as linhas ao detector de cabeçalho.
2. Identificar os aliases.
3. Produzir schema tabular.
4. Validar presença de campos mínimos.
5. Gerar warnings em caso de schema parcial.

## Etapa 6 — Extração transacional

1. Normalizar datas.
2. Normalizar valores.
3. Combinar débito e crédito, quando necessário.
4. Preservar histórico.
5. Preservar documento.
6. Preservar saldo, quando disponível.
7. Gerar movimentos financeiros.

## Etapa 7 — Resultado

O resultado deverá conter:

* movimentos extraídos;
* aba utilizada;
* confiança da seleção;
* warnings;
* evidências;
* métricas;
* erro estruturado, quando aplicável.

---

# 15. Tratamento de erros

## 15.1 Classes sugeridas

```ts
export class TabularParsingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TabularParsingError";
  }
}
```

## 15.2 Códigos de erro

| Código                                | Situação                              |
| ------------------------------------- | ------------------------------------- |
| `UNSUPPORTED_TABULAR_FORMAT`          | Extensão não suportada                |
| `EMPTY_FILE`                          | Buffer vazio                          |
| `FILE_SIZE_LIMIT_EXCEEDED`            | Arquivo acima do limite               |
| `INVALID_SPREADSHEET`                 | Conteúdo inválido                     |
| `CORRUPTED_SPREADSHEET`               | Estrutura corrompida                  |
| `WORKBOOK_WITHOUT_SHEETS`             | Workbook sem abas                     |
| `SHEET_LIMIT_EXCEEDED`                | Quantidade excessiva de abas          |
| `ROW_LIMIT_EXCEEDED`                  | Quantidade excessiva de linhas        |
| `COLUMN_LIMIT_EXCEEDED`               | Quantidade excessiva de colunas       |
| `CELL_LIMIT_EXCEEDED`                 | Quantidade total excessiva de células |
| `NO_TRANSACTIONAL_SHEET_FOUND`        | Nenhuma aba adequada encontrada       |
| `NO_HEADER_FOUND`                     | Cabeçalho não identificado            |
| `REQUIRED_COLUMNS_NOT_FOUND`          | Colunas mínimas ausentes              |
| `ENCRYPTED_SPREADSHEET_NOT_SUPPORTED` | Arquivo protegido ou criptografado    |
| `SPREADSHEET_PARSE_FAILED`            | Falha genérica controlada             |

## 15.3 Warnings sugeridos

| Código                             | Situação                            |
| ---------------------------------- | ----------------------------------- |
| `LOW_CONFIDENCE_SHEET_SELECTION`   | Aba selecionada com baixa confiança |
| `FIRST_NON_EMPTY_SHEET_FALLBACK`   | Utilizado fallback                  |
| `HIDDEN_SHEET_SELECTED`            | Aba oculta selecionada              |
| `FORMULA_WITHOUT_CACHED_VALUE`     | Fórmula sem resultado               |
| `INVALID_DATE_VALUE`               | Data não normalizada                |
| `INVALID_AMOUNT_VALUE`             | Valor não normalizado               |
| `DUPLICATE_HEADER_ALIAS`           | Mais de uma coluna candidata        |
| `TRUNCATED_EMPTY_TRAILING_COLUMNS` | Colunas finais vazias removidas     |
| `PARTIAL_SCHEMA_DETECTED`          | Schema incompleto                   |
| `MACRO_ENABLED_FILE`               | Arquivo habilitado para macros      |
| `UNEXPECTED_CELL_TYPE`             | Tipo de célula inesperado           |

---

# 16. Alterações previstas no código

## 16.1 Novo módulo de leitura

Criar:

```text
packages/core/src/tabular/spreadsheet-reader.ts
```

Responsabilidades:

* abrir o workbook;
* aplicar limites;
* obter as abas;
* selecionar a aba;
* converter células;
* retornar `ExtractedTabularDocument`.

## 16.2 Modificação de `files.ts`

A função responsável pela leitura tabular deverá encaminhar cada extensão ao parser correto.

Exemplo conceitual:

```ts
export async function tabularRows(
  buffer: Buffer,
  extension: string,
  fileName?: string,
): Promise<ExtractedTabularDocument> {
  return parseTabularFile({
    buffer,
    extension,
    fileName,
  });
}
```

O arquivo `files.ts` não deverá conter detalhes específicos de SheetJS.

## 16.3 Modificação do package.json

Adicionar a dependência SheetJS ao pacote `@conciliacao/core`.

A versão deverá ser fixada e validada antes do merge.

## 16.4 Modificação da matriz de suporte

Atualizar:

```text
packages/core/src/corpus-support-matrix.ts
```

A matriz deverá representar:

| Formato       | Classificação | Identidade | Período | Movimentos |             Saldo | Conciliação |
| ------------- | ------------: | ---------: | ------: | ---------: | ----------------: | ----------: |
| CSV bancário  |           Sim |        Sim |     Sim |        Sim | Quando disponível |         Sim |
| XLSX bancário |           Sim |        Sim |     Sim |        Sim | Quando disponível |         Sim |
| XLS bancário  |           Sim |        Sim |     Sim |        Sim | Quando disponível |         Sim |
| XLSM bancário |           Sim |        Sim |     Sim |        Sim | Quando disponível |         Sim |
| PDF bancário  |           Sim |        Sim |     Sim |        Sim |               Sim |         Sim |

A qualidade efetiva continuará dependendo do schema de cada arquivo.

## 16.5 Migração do `csv-schema.ts`

O arquivo poderá ser renomeado futuramente para:

```text
tabular-schema.ts
```

A mudança poderá ocorrer nesta entrega ou em etapa posterior, desde que:

* não duplique regras;
* não mantenha lógica exclusiva para CSV;
* aceite linhas provenientes de Excel.

---

# 17. Estratégia de seleção da aba

## 17.1 Janela de análise

Cada aba deverá ser analisada inicialmente em uma janela limitada.

Configuração inicial:

```ts
const SHEET_PREVIEW_ROWS = 50;
```

## 17.2 Pontuação mínima

Exemplo inicial:

| Evidência                             | Pontos |
| ------------------------------------- | -----: |
| Coluna de data                        |    +30 |
| Coluna de valor                       |    +30 |
| Colunas separadas de débito e crédito |    +30 |
| Coluna de histórico                   |    +20 |
| Coluna de documento                   |    +10 |
| Coluna de saldo                       |    +10 |
| Mais de 5 linhas de dados             |    +10 |
| Mais de 20 linhas de dados            |    +10 |
| Aba oculta                            |    -20 |
| Menos de 3 linhas preenchidas         |    -30 |
| Apenas uma coluna preenchida          |    -20 |
| Nome semelhante a capa ou instruções  |    -15 |

A fórmula deverá ser ajustada com base no corpus real.

## 17.3 Níveis de confiança

```ts
function sheetConfidence(score: number) {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}
```

Os limites deverão ser calibrados por testes.

## 17.4 Nome da aba

O nome da aba poderá contribuir como sinal secundário.

Nomes positivos:

* extrato;
* lançamentos;
* lancamentos;
* movimento;
* movimentos;
* transações;
* transacoes;
* conta corrente;
* movimentação;
* movimentacao.

Nomes negativos:

* instruções;
* instrucoes;
* leia-me;
* capa;
* resumo;
* parâmetros;
* parametros.

O nome nunca deverá ser o único critério.

---

# 18. Normalização de células

## 18.1 Valor bruto e valor exibido

O sistema deverá preservar as duas representações sempre que possível.

Exemplo:

```ts
{
  rawValue: 45291,
  displayValue: "31/12/2023"
}
```

## 18.2 Conversão segura para string

```ts
export function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return formatAccountingDate(value);
  }

  return String(value).trim();
}
```

## 18.3 Proibição de coerção prematura

O leitor não deverá converter todas as células imediatamente para:

* número;
* data;
* booleano.

A interpretação deverá considerar:

* cabeçalho da coluna;
* valor bruto;
* valor exibido;
* contexto do schema.

## 18.4 Proteção contra conteúdo de fórmula

Quando dados forem futuramente exportados para CSV ou XLSX, valores iniciados por caracteres de fórmula deverão passar pela proteção já existente.

Exemplos:

```text
=
+
-
@
```

A leitura não deverá executar esse conteúdo.

---

# 19. Plano de testes

## 19.1 Testes unitários do leitor

Criar testes para:

1. Ler XLSX simples.
2. Ler XLS legado.
3. Ler XLSM sem executar macros.
4. Retornar nome da aba.
5. Preservar número da linha.
6. Preservar células vazias intermediárias.
7. Remover linhas totalmente vazias.
8. Preservar zeros à esquerda.
9. Preservar valor bruto.
10. Preservar valor exibido.
11. Identificar fórmula.
12. Usar resultado armazenado de fórmula.
13. Gerar warning para fórmula sem resultado.
14. Rejeitar buffer vazio.
15. Rejeitar workbook inválido.
16. Rejeitar workbook sem abas.
17. Respeitar limite de tamanho.
18. Respeitar limite de linhas.
19. Respeitar limite de colunas.
20. Respeitar limite de células.

## 19.2 Testes unitários da seleção de aba

Criar testes para:

1. Extrato na primeira aba.
2. Extrato na segunda aba.
3. Primeira aba contendo capa.
4. Primeira aba contendo resumo.
5. Aba oculta contendo dados.
6. Duas abas com schemas parecidos.
7. Nenhuma aba com schema reconhecível.
8. Fallback para primeira aba não vazia.
9. Pontuação baseada em aliases.
10. Pontuação baseada em densidade.
11. Penalidade para aba vazia.
12. Penalidade para aba oculta.
13. Nível de confiança alto.
14. Nível de confiança médio.
15. Nível de confiança baixo.

## 19.3 Testes de datas

Cobrir:

* serial do Excel;
* texto brasileiro;
* texto ISO;
* objeto `Date`;
* data com horário;
* célula inválida;
* data anterior a 1900;
* mudança de timezone;
* sistema de datas alternativo do workbook, quando aplicável.

## 19.4 Testes de valores

Cobrir:

* formato brasileiro;
* formato internacional;
* símbolo de moeda;
* valor negativo;
* valor negativo entre parênteses;
* débito e crédito separados;
* valor zero;
* célula vazia;
* separadores inconsistentes;
* valor armazenado como número;
* valor armazenado como texto.

## 19.5 Testes de regressão

Executar toda a suíte existente.

A entrega não poderá reduzir a quantidade de testes aprovados.

Os testes deverão comprovar que não houve regressão em:

* CSV;
* PDF;
* classificação;
* schema;
* exportações;
* conciliação;
* evidências.

## 19.6 Testes de integração

O teste deverá processar o arquivo completo pelo fluxo:

```text
Buffer
→ parser
→ documento tabular
→ detecção de schema
→ normalização
→ movimentos
→ resultado de conciliação
```

## 19.7 Corpus real

Deverão ser utilizados:

* arquivos bancários reais privados;
* ou versões sanitizadas estruturalmente equivalentes.

Obrigatoriamente incluir:

* arquivo que provocava crash no ExcelJS;
* arquivo com múltiplas abas;
* arquivo com linhas de apresentação;
* arquivo com datas numéricas;
* arquivo com valores formatados;
* arquivo com metadados incomuns;
* arquivo habilitado para macros, caso esteja disponível.

Os arquivos privados não deverão ser incluídos em repositórios públicos.

---

# 20. Critérios de aceite

## CA-001

Dado um XLSX bancário válido, quando o arquivo for processado, então o sistema deverá retornar linhas tabulares sem utilizar ExcelJS.

## CA-002

Dado um arquivo com capa na primeira aba e lançamentos na segunda, quando processado, então a segunda aba deverá ser selecionada.

## CA-003

Dado um XLSM, quando processado, então os dados das células deverão ser lidos sem execução de macros.

## CA-004

Dado um XLS legado, quando processado, então o conteúdo deverá entrar no mesmo pipeline utilizado pelo XLSX.

## CA-005

Dado um arquivo corrompido, quando processado, então deverá retornar erro controlado sem encerrar a aplicação.

## CA-006

Dado um arquivo acima do limite configurado, quando processado, então deverá ser rejeitado antes de consumir recursos excessivos.

## CA-007

Dada uma célula com data serial, quando normalizada, então deverá resultar na data contábil correta.

## CA-008

Dado um documento `001234`, quando extraído, então os zeros à esquerda deverão ser preservados.

## CA-009

Dado um valor `R$ 1.234,56`, quando normalizado, então deverá resultar no valor numérico correto.

## CA-010

Dada uma fórmula com resultado armazenado, quando lida, então deverá utilizar o resultado sem recalcular a fórmula.

## CA-011

Dada uma fórmula sem resultado armazenado, quando lida, então deverá gerar warning e não executar a fórmula.

## CA-012

Dado um arquivo CSV existente, quando processado após a implementação, então o comportamento anterior deverá permanecer válido.

## CA-013

Dado um lançamento extraído, quando consultada sua evidência, então deverão estar disponíveis o arquivo, a aba e a linha original.

## CA-014

Dado o corpus bancário utilizado na homologação, nenhum arquivo XLSX válido deverá provocar crash fatal.

## CA-015

Toda a suíte automatizada anterior e todos os novos testes deverão passar no pipeline de CI.

---

# 21. Plano de implementação

## Fase 1 — Preparação arquitetural

1. Criar os tipos tabulares genéricos.
2. Criar erros e warnings padronizados.
3. Criar limites configuráveis.
4. Adicionar a dependência SheetJS.
5. Garantir fixação da versão no lockfile.
6. Criar testes básicos dos contratos.

### Entrega da fase

* tipos compilando;
* dependência instalada;
* nenhuma alteração funcional no comportamento anterior.

## Fase 2 — Parser básico de planilhas

1. Implementar leitura de XLSX.
2. Implementar leitura de XLS.
3. Implementar leitura de XLSM.
4. Ler a primeira aba como comportamento temporário interno.
5. Converter células para modelo tabular.
6. Criar tratamento de erros.
7. Criar testes unitários.

### Entrega da fase

* formatos lidos isoladamente;
* sem integração definitiva com detecção automática.

## Fase 3 — Seleção automática de aba

1. Implementar preview das abas.
2. Implementar normalização de cabeçalhos.
3. Implementar scoring.
4. Implementar confiança.
5. Implementar fallback.
6. Registrar warnings.
7. Criar testes específicos.

### Entrega da fase

* extrato não precisa estar na primeira aba.

## Fase 4 — Integração com schema

1. Adaptar `csv-schema.ts` ao modelo tabular.
2. Remover dependência conceitual de CSV.
3. Conectar XLSX ao fluxo de aliases.
4. Validar datas.
5. Validar valores.
6. Preservar evidências.

### Entrega da fase

* planilhas geram movimentos financeiros normalizados.

## Fase 5 — Integração em `files.ts`

1. Atualizar roteamento por extensão.
2. Remover ExcelJS do fluxo de leitura.
3. Manter ExcelJS somente para exportação, caso necessário.
4. Garantir compatibilidade com os consumidores existentes.
5. Adicionar testes de integração.

### Entrega da fase

* fluxo principal utiliza SheetJS.

## Fase 6 — Corpus e homologação

1. Executar todos os arquivos XLSX disponíveis.
2. Executar XLS e XLSM disponíveis.
3. Comparar resultado com origem.
4. Validar datas, valores, documentos e saldos.
5. Ajustar aliases.
6. Ajustar scoring das abas.
7. Registrar limitações conhecidas.
8. Atualizar matriz de suporte.

### Entrega da fase

* suporte homologado com arquivos reais.

## Fase 7 — Limpeza e documentação

1. Remover código morto.
2. Remover dependências de leitura do ExcelJS.
3. Atualizar documentação.
4. Atualizar exemplos.
5. Atualizar changelog.
6. Atualizar instruções de operação.
7. Confirmar licenças.
8. Confirmar métricas e logs.

---

# 22. Estratégia de rollout

## 22.1 Feature flag

Recomenda-se introduzir uma flag temporária:

```ts
USE_SHEETJS_SPREADSHEET_READER=true
```

Durante a homologação:

* ambiente de desenvolvimento: habilitado;
* ambiente de testes: habilitado;
* produção: controlado.

Depois da homologação, o novo leitor deverá se tornar o comportamento padrão.

## 22.2 Comparação paralela

Caso seja tecnicamente possível, durante os testes internos:

1. processar o mesmo arquivo pelo leitor antigo;
2. processar pelo novo leitor;
3. comparar quantidade de linhas;
4. comparar cabeçalhos;
5. comparar datas;
6. comparar valores;
7. comparar erros.

O leitor antigo não deverá ser mantido indefinidamente.

## 22.3 Rollback

Em caso de falha após implantação:

* desabilitar a feature flag;
* retornar temporariamente ao fluxo anterior;
* preservar os arquivos que falharam;
* registrar métricas;
* adicionar os casos ao corpus de regressão;
* corrigir antes da reativação.

---

# 23. Riscos e mitigações

## Risco 1 — Consumo excessivo de memória

Planilhas grandes podem ser carregadas integralmente em memória.

### Mitigação

* limite de tamanho;
* limite de células;
* limite de linhas;
* limite de colunas;
* rejeição antecipada;
* métricas de duração e memória.

## Risco 2 — Seleção incorreta da aba

O algoritmo pode selecionar uma aba de resumo em vez da aba de lançamentos.

### Mitigação

* scoring por aliases;
* exigência de data e valor;
* penalidades;
* confiança;
* warning;
* testes com corpus real.

## Risco 3 — Datas incorretas

Datas seriais podem ser interpretadas incorretamente.

### Mitigação

* preservar valor bruto e exibido;
* normalizador dedicado;
* testes de timezone;
* testes com datas reais.

## Risco 4 — Perda de zeros à esquerda

Documentos e identificadores podem ser convertidos em números.

### Mitigação

* preservar valor exibido;
* não realizar coerção antecipada;
* interpretar conforme o schema.

## Risco 5 — Fórmulas sem valor

Algumas planilhas podem depender de recálculo.

### Mitigação

* utilizar valor armazenado;
* gerar warning;
* não executar fórmula;
* informar limitação ao usuário.

## Risco 6 — Dependência externa

A biblioteca passa a ser componente crítico do parser.

### Mitigação

* versão fixada;
* lockfile;
* testes de regressão;
* análise de licença;
* processo controlado de atualização.

## Risco 7 — Arquivos protegidos por senha

O parser pode não conseguir abrir arquivos criptografados.

### Mitigação

* erro específico;
* mensagem clara;
* não tentar burlar proteção;
* solicitar versão sem senha no processo operacional.

## Risco 8 — Arquivos com extensão incorreta

Um arquivo nomeado `.xlsx` pode não ser um workbook válido.

### Mitigação

* validação do conteúdo;
* captura de erro;
* código `INVALID_SPREADSHEET`.

---

# 24. Segurança

A implementação deverá garantir:

* macros nunca executadas;
* fórmulas nunca executadas;
* links externos não acessados;
* objetos incorporados ignorados;
* arquivos limitados por tamanho;
* dados financeiros não expostos nos logs;
* mensagens de erro sem dump completo do conteúdo;
* arquivos privados fora do repositório público;
* dependência versionada e auditável;
* buffers descartados após o processamento quando não forem mais necessários.

---

# 25. Observabilidade

## Métricas sugeridas

```text
tabular_parse_total
tabular_parse_success_total
tabular_parse_failure_total
tabular_parse_duration_ms
tabular_rows_extracted_total
tabular_sheet_selection_confidence
tabular_warning_total
tabular_file_size_bytes
```

Dimensões permitidas:

* formato;
* banco identificado;
* sucesso ou falha;
* código de erro;
* confiança.

Não utilizar como dimensão:

* número da conta;
* nome do cliente;
* histórico completo;
* valor financeiro;
* documento bancário.

---

# 26. Documentação operacional

A documentação do usuário deverá informar:

1. Formatos aceitos.
2. Limites de tamanho.
3. Como obter o extrato em XLSX ou CSV.
4. Que macros não são executadas.
5. Que planilhas protegidas podem não ser aceitas.
6. Que a aba é identificada automaticamente.
7. Que arquivos estruturados são preferíveis a PDF.
8. Que PDF continua disponível como fallback.
9. Como interpretar warnings.
10. Como reportar um arquivo não suportado.

Mensagem sugerida para arquivo protegido:

```text
Não foi possível ler a planilha porque ela está protegida ou criptografada. Exporte uma nova versão em XLSX, XLS ou CSV sem senha e tente novamente.
```

Mensagem sugerida para aba não encontrada:

```text
Nenhuma aba com estrutura de extrato bancário foi identificada. Verifique se o arquivo contém colunas de data, histórico e valor, débito ou crédito.
```

---

# 27. Definition of Done

A implementação estará concluída quando:

* [ ] SheetJS estiver instalado com versão fixada.
* [ ] XLSX estiver sendo lido pelo novo parser.
* [ ] XLS estiver sendo lido pelo novo parser.
* [ ] XLSM estiver sendo lido sem execução de macros.
* [ ] ExcelJS não estiver no fluxo de leitura.
* [ ] Modelo tabular genérico estiver implementado.
* [ ] Aba transacional estiver sendo selecionada automaticamente.
* [ ] Evidência de aba e linha estiver preservada.
* [ ] Datas estiverem normalizadas.
* [ ] Valores monetários estiverem normalizados.
* [ ] Zeros à esquerda estiverem preservados.
* [ ] Fórmulas estiverem tratadas com segurança.
* [ ] Limites de recursos estiverem implementados.
* [ ] Erros tipados estiverem implementados.
* [ ] Warnings estiverem implementados.
* [ ] Testes unitários estiverem passando.
* [ ] Testes de integração estiverem passando.
* [ ] Suíte anterior estiver passando integralmente.
* [ ] Arquivos problemáticos do corpus estiverem processando sem crash.
* [ ] Matriz de suporte estiver atualizada.
* [ ] Documentação técnica estiver atualizada.
* [ ] Documentação operacional estiver atualizada.
* [ ] Feature flag tiver sido removida ou documentada após homologação.
* [ ] Alteração tiver sido aprovada na revisão de código.

---

# 28. Ordem recomendada de execução

```text
1. Criar contratos tabulares
2. Adicionar SheetJS
3. Criar parser básico
4. Criar normalizador de células
5. Criar seleção automática de aba
6. Integrar ao schema existente
7. Integrar ao files.ts
8. Adicionar limites e erros
9. Criar testes de integração
10. Executar corpus real
11. Ajustar aliases e scoring
12. Atualizar matriz de suporte
13. Remover leitura antiga
14. Documentar
15. Homologar
```

---

# 29. Decisão arquitetural final

A arquitetura aprovada será:

> SheetJS como parser principal de entrada para XLSX, XLS e XLSM. ExcelJS permanecerá apenas em funcionalidades de geração, edição ou exportação de planilhas. CSV e Excel compartilharão um modelo tabular genérico, preservando arquivo, aba, linha, valor bruto e valor exibido. A aba transacional será selecionada automaticamente com base em aliases, densidade de dados e estrutura provável de extrato.

A primeira aba poderá ser utilizada apenas como fallback controlado, nunca como regra principal.

XLSX e CSV deverão ser considerados fontes transacionais estruturadas prioritárias. PDF continuará sendo suportado como fonte documental e fallback quando formatos estruturados não estiverem disponíveis.
