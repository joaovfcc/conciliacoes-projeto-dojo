# Automação de Conciliação Bancária

Aplicação local para comparar o razão do Protheus com extratos bancários e produzir um Excel
auditável. Ela trabalha somente com arquivos: não acessa Protheus, bancos, internet ou banco de
dados, e não armazena credenciais.

## O que está incluído

- razão em CSV ou XLSX;
- extrato em CSV, XLSX ou OFX 1.x/2.x com blocos `STMTTRN`;
- validação de nomes, período, extensões, cabeçalhos, dados, contas e duplicidades;
- processamento parcial: uma conta/linha inválida não oculta as contas válidas;
- regras exata, tolerância de data, valor/data sem documento, divergência de valor/data,
  ausências, ambiguidades e possíveis duplicidades;
- relatório Excel com oito abas, filtros, campos de tratamento humano e rastreabilidade;
- log por execução, manifesto SHA-256, arquivamento e reprocessamento explícito;
- CLI, arquivo BAT e build opcional de executável Windows.

Agrupamentos muitos-para-muitos, PDF/OCR, integrações, aprovação eletrônica, interface web e
histórico em banco permanecem fora do MVP.

## Arquitetura resumida

```text
CLI/BAT
  -> configuração + descoberta
  -> adaptadores CSV/XLSX/OFX
  -> registros normalizados com Decimal e origem
  -> motor conservador um-para-um
  -> Excel + log
  -> arquivo de entrada preservado em Processados/Pendências + manifesto
```

O domínio não depende de Excel. Layouts entram por adaptadores isolados, e o resumo é calculado
a partir dos mesmos resultados que alimentam as abas detalhadas. Veja
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Requisitos

- Windows 10/11;
- Python 3.11 ou superior para desenvolvimento/execução por fonte;
- Microsoft Excel ou leitor compatível apenas para abrir/configurar os workbooks;
- permissão de leitura e escrita na raiz operacional.

O executável em `dist/conciliacao.exe`, quando gerado, não exige instalação de Python.

## Instalação limpa para desenvolvimento

No PowerShell, na raiz do projeto:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pip install -e . --no-deps
```

Para uma instalação somente de uso:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip install -e . --no-deps
```

Não há variável obrigatória nem segredo. `CONCILIACAO_LOG_LEVEL` está reservado no
`.env.example`; nesta versão o log operacional usa `INFO`.

## Preparar uma raiz operacional

```powershell
.\.venv\Scripts\python.exe -m conciliacao init --base-dir C:\Conciliacao
```

Ou com o executável:

```powershell
.\dist\conciliacao.exe init --base-dir C:\Conciliacao
```

Isso cria:

```text
C:\Conciliacao\
├── 01_Entrada\
│   ├── Razao\
│   └── Extratos\
├── 02_Processados\
├── 03_Pendencias\
├── 04_Resultados\
└── 05_Configuracao\
    └── CONFIGURACAO_CONTAS.xlsx
```

Abra `CONFIGURACAO_CONTAS.xlsx`, preencha ao menos uma linha ativa na aba `Contas` e feche o
Excel. Os campos estão descritos em [`docs/LAYOUTS.md`](docs/LAYOUTS.md).

## Executar

Coloque os arquivos nas pastas de entrada e execute:

```powershell
.\.venv\Scripts\python.exe -m conciliacao run --base-dir C:\Conciliacao --periodo 202607
```

Se o projeto estiver instalado na própria raiz operacional:

```powershell
.\executar_conciliacao.bat --periodo 202607
```

O BAT usa `dist\conciliacao.exe` quando disponível e, como fallback, `.venv`. Para autorizar
deliberadamente conteúdo já processado:

```powershell
.\.venv\Scripts\python.exe -m conciliacao run --base-dir C:\Conciliacao --periodo 202607 --reprocessar
```

O relatório anterior nunca é sobrescrito; reprocessamentos recebem sufixo de data/hora.

Para uma demonstração com dados estritamente fictícios em uma pasta vazia:

```powershell
.\.venv\Scripts\python.exe .\scripts\create_demo_workspace.py `
  --base-dir .\runtime\demo --periodo 202607
.\dist\conciliacao.exe run --base-dir .\runtime\demo --periodo 202607
```

## Convenção dos arquivos

```text
RAZAO_EMPRESA_FILIAL_AAAAMM.csv
RAZAO_EMPRESA_FILIAL_AAAAMM.xlsx
EXTRATO_BANCO_AGENCIA_CONTA_AAAAMM.csv
EXTRATO_BANCO_AGENCIA_CONTA_AAAAMM.xlsx
EXTRATO_BANCO_AGENCIA_CONTA_AAAAMM.ofx
```

Exemplos:

```text
RAZAO_SPREAD_MATRIZ_202607.xlsx
EXTRATO_ITAU_1234_567890_202607.ofx
```

CSV aceita `;`, `,`, tabulação ou `|`, em UTF-8/UTF-8 BOM ou Latin-1. XLSX usa a primeira aba.
Datas aceitas: `DD/MM/AAAA`, `AAAA-MM-DD`, `DD-MM-AAAA` ou `AAAAMMDD`. Valores aceitam
formato brasileiro/internacional e parênteses contábeis. Detalhes e aliases:
[`docs/LAYOUTS.md`](docs/LAYOUTS.md).

## Saída

Em `04_Resultados\AAAA-MM` são gerados:

- `CONCILIACAO_EMPRESA_AAAAMM.xlsx`;
- `LOG_PROCESSAMENTO_AAAAMM_AAAAMMDD_HHMMSS_ffffff.txt`.

O Excel contém `Resumo`, `Conciliados`, `Divergencias_Detalhadas`, `Razao_Sem_Extrato`,
`Extrato_Sem_Razao`, `Ambiguidades`, `Arquivos_Processados` e `Erros_Tecnicos`. Campos iniciados
por `=`, `+`, `-` ou `@` vindos de texto são neutralizados para impedir formula injection.

Entradas válidas são movidas, sem alteração de conteúdo, para `02_Processados\AAAA-MM`;
rejeitadas vão para `03_Pendencias\AAAA-MM`. O manifesto
`02_Processados\processed_hashes.json` registra hashes e execuções.

## Tratamento de erros

- erro de registro: a linha vai para `Erros_Tecnicos` e outras linhas válidas continuam;
- arquivo inválido/desconhecido: vai para pendências e recebe orientação;
- configuração ausente/inválida, manifesto corrompido ou falha de output: execução crítica;
  entradas ainda não arquivadas são preservadas;
- candidatos múltiplos: nenhuma escolha é feita; o caso aparece em `Ambiguidades`;
- hash já visto: execução é recusada, salvo com `--reprocessar`.

Consulte também [`docs/MANUAL_USUARIO.md`](docs/MANUAL_USUARIO.md).

## Qualidade e build

```powershell
# Formatação
.\.venv\Scripts\python.exe -m ruff format .

# Lint e verificação da formatação
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .

# Testes e cobertura (mínimo configurado: 85%)
.\.venv\Scripts\python.exe -m pytest

# Wheel e source distribution
.\.venv\Scripts\python.exe -m build

# Executável Windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build_executable.ps1
```

Validação atual: 44 testes aprovados e 89,82% de cobertura de linhas/branches combinada. A CI em
`.github/workflows/quality.yml` repete lint, formatação, testes e build no Windows.

## Estrutura do repositório

```text
src/conciliacao/       aplicação e domínio
tests/unit/            normalização, regras e CLI
tests/integration/     arquivos, configuração, descoberta e Excel
tests/e2e/             execução mensal e reprocessamento
scripts/               build do executável
docs/                  arquitetura, layouts, manual e rastreabilidade
```

## Solução de problemas

- `A aba Contas não possui...`: execute `init`, preencha a configuração e feche o Excel.
- `COLUNAS_AUSENTES`: compare os cabeçalhos com `docs/LAYOUTS.md`.
- `PERIODO_DIVERGENTE`: alinhe o nome e as datas internas ao `--periodo`.
- `CONTA_*_NAO_CONFIGURADA`: revise empresa/filial/conta ou banco/agência/conta.
- `conteúdo já foi processado`: confirme se é reexecução legítima antes de usar
  `--reprocessar`.
- PowerShell bloqueia o script de build: use exatamente o comando com
  `-ExecutionPolicy Bypass`; ele altera a política somente do processo atual.

## Limitações e decisões

Os aliases cobrem o contrato canônico e exemplos comuns; layouts bancários reais ainda devem
ser homologados com fixtures anonimizadas. OFX é lido sem dependência externa e exige blocos
`STMTTRN`. A aprovação contábil e a meta de desempenho dependem do piloto com amostras reais.
Veja [`docs/DECISIONS.md`](docs/DECISIONS.md) e
[`docs/PRD_TRACEABILITY.md`](docs/PRD_TRACEABILITY.md).
