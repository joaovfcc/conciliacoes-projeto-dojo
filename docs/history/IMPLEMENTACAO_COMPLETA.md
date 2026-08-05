# Visão completa da implementação

> A proposta e os requisitos para a evolução web em TypeScript/Vercel estão em
> Documento histórico da implementação Python. A implementação oficial atual é TypeScript.
> Consulte o [PRD da aplicação web](../product/PRD_APLICACAO_WEB.md).

## 1. Objetivo deste documento

Este documento explica, em ordem lógica e cronológica, o que foi implementado no projeto de
conciliação bancária, como cada parte funciona, por que as principais decisões foram tomadas,
como a solução foi testada e quais limites ainda existem.

O projeto nasceu de dois conjuntos de requisitos:

1. o PRD principal de automação da conciliação entre o razão do Protheus e extratos bancários;
2. o adendo que acrescentou leitura de extratos em PDF pesquisável ou digitalizado, com OCR,
   rastreabilidade por página e parsers por layout bancário.

O resultado é uma aplicação local para Windows, executável por linha de comando, arquivo BAT ou
executável único. Ela trabalha exclusivamente com arquivos e gera um Excel auditável. Não acessa
o Protheus, o banco, a internet ou um banco de dados.

---

## 2. Resultado final em uma frase

A aplicação recebe um razão em CSV/XLSX e um ou mais extratos em CSV/XLSX/OFX/PDF, valida e
normaliza os dados, aplica regras conservadoras de conciliação um-para-um, gera um relatório Excel
com evidências detalhadas, registra um log, arquiva os arquivos sem alterar seu conteúdo e impede
reprocessamentos acidentais por hash SHA-256.

O fluxo completo é:

```text
configuração + arquivos de entrada
                |
                v
descoberta, nome, período, formato e hash
                |
                v
leitores CSV/XLSX/OFX/PDF
                |
                v
normalização para modelos comuns com Decimal e origem
                |
                v
relacionamento entre conta contábil e conta bancária
                |
                v
motor conservador de conciliação, regras 1 a 9
                |
                v
Excel auditável + log + manifesto
                |
                v
arquivamento em Processados ou Pendências
```

---

## 3. Decisões arquiteturais principais

| Decisão | Motivo | Consequência prática |
|---|---|---|
| Aplicação local e orientada a arquivos | O processo real já recebe razão e extrato como arquivos, e o MVP não precisava de integração on-line | Instalação simples, nenhuma credencial bancária e menor superfície de risco |
| Sem banco de dados | O estado necessário cabe nos arquivos, no relatório e no manifesto de hashes | Menos infraestrutura; a pasta operacional precisa ser preservada |
| Sem interface web | O usuário precisa executar uma rotina mensal, não operar um sistema multiusuário | CLI, BAT e `.exe` são suficientes para o MVP e reduzem manutenção |
| Python 3.11+ | Bom suporte a arquivos, datas, valores, testes e distribuição Windows | Desenvolvimento rápido e possibilidade de gerar executável com PyInstaller |
| OpenPyXL e registros próprios, sem Pandas | Era importante controlar `Decimal`, tipos e origem sem coerções implícitas e sem inflar o executável | Adaptadores têm mais código explícito, mas o domínio é previsível e testável |
| `Decimal` para dinheiro | `float` pode introduzir erros binários em centavos | Comparações e totais monetários permanecem determinísticos |
| Arquitetura em camadas leves | Formato do arquivo não deve contaminar as regras contábeis | É possível acrescentar um novo banco ou layout sem reescrever o motor |
| Regras conservadoras e ordenadas | Um falso positivo é mais perigoso que deixar um item para revisão | Casos ambíguos não são conciliados arbitrariamente |
| Geração do relatório antes de mover entradas | Um erro crítico não pode fazer os arquivos desaparecerem da entrada sem evidência de saída | Arquivamento só começa depois que o Excel foi salvo |
| SHA-256 em manifesto JSON | O mesmo conteúdo pode voltar com outro nome | Reprocessamento silencioso é bloqueado; `--reprocessar` torna a intenção explícita |
| Extração direta do PDF antes do OCR | PDFs pesquisáveis têm texto mais confiável e são mais rápidos de processar | OCR só é usado nas páginas que realmente precisam dele |
| OCR opcional e isolado | Poppler/Tesseract são ferramentas externas e precisam ser homologadas no ambiente corporativo | OCR fica desabilitado por padrão e é executado sem shell, com timeout e limites |
| Parser específico antes do genérico | Layouts bancários variam e uma expressão regular permissiva pode inventar movimentos | Layout desconhecido é rejeitado para revisão em vez de gerar dados falsos |
| Fixtures sintéticas no repositório | Extratos reais têm informação sensível | Regressões são cobertas sem versionar dados bancários reais |

---

## 4. Implementação passo a passo

### Passo 1 — Leitura do PRD e definição do limite do MVP

Primeiro foram separados o objetivo, os atores, as entradas, as saídas, os requisitos funcionais,
os requisitos não funcionais e os critérios de aceite.

O escopo aprovado ficou assim:

- razão do Protheus por arquivo;
- extratos bancários por arquivo;
- normalização de datas, documentos, valores e identificadores;
- relacionamento entre conta contábil e conta bancária;
- conciliação um-para-um por regras explícitas;
- tratamento de divergências, ausências, ambiguidades e possíveis duplicidades;
- Excel detalhado, log, arquivamento e reprocessamento controlado.

Ficaram fora do MVP: integração direta com Protheus ou bancos, RPA, banco de dados, workflow de
aprovação, interface web, uso multiusuário e agrupamentos muitos-para-muitos.

**Motivo:** limitar a primeira versão ao problema essencial permitiu entregar um processo
auditável sem criar infraestrutura que não era necessária para validar a regra contábil.

### Passo 2 — Fundação técnica e qualidade

Foi criado um pacote Python instalável em `src/conciliacao`, com:

- dependências de execução em `requirements.txt` e `pyproject.toml`;
- dependências de desenvolvimento em `requirements-dev.txt`;
- Pytest com cobertura mínima obrigatória de 85%;
- Ruff para lint e formatação;
- build de wheel e source distribution;
- pipeline Windows em `.github/workflows/quality.yml`;
- build de executável Windows por PyInstaller.

**Motivo:** a conciliação manipula valores financeiros; por isso, correção reproduzível, testes
automatizados e build verificável foram tratados como parte do produto, não como acabamento.

### Passo 3 — Modelos de domínio independentes dos arquivos

Foram definidos modelos imutáveis para:

- configuração de conta;
- lançamento do razão;
- movimento bancário;
- conteúdo bruto de página PDF;
- transação e extrato PDF normalizados;
- resultado da conciliação;
- erro técnico;
- arquivo processado;
- resultado completo da execução.

Os modelos ficam em `src/conciliacao/models.py`. Eles usam tipos nativos de data, `Decimal` para
dinheiro e campos de origem como arquivo, linha, página, trecho, parser e método de extração.

**Motivo:** depois que um adaptador transforma sua entrada nesses modelos, o motor não precisa
saber se o dado veio de CSV, Excel, OFX ou PDF. Isso reduz acoplamento e torna as regras testáveis
sem abrir arquivos.

### Passo 4 — Normalização segura de dados

Foi implementada uma camada comum para:

- valores brasileiros e internacionais;
- sinais negativos e parênteses contábeis;
- datas em formatos usuais e células de data do Excel;
- documentos com preservação de zeros à esquerda;
- nomes de cabeçalhos com acentos, espaços e pontuação diferentes;
- códigos de empresa, filial, conta, banco e agência.

**Motivo:** os arquivos reais representam o mesmo conceito de formas diferentes. Normalizar uma
vez evita que cada regra de conciliação tenha várias versões do mesmo tratamento.

### Passo 5 — Estrutura operacional e configuração fora do código

O comando `init` cria:

```text
RAIZ_OPERACIONAL/
├── 01_Entrada/
│   ├── Razao/
│   └── Extratos/
├── 02_Processados/
├── 03_Pendencias/
├── 04_Resultados/
└── 05_Configuracao/
    └── CONFIGURACAO_CONTAS.xlsx
```

A planilha de configuração possui abas `Contas`, `Layouts`, `Parametros` e `Instrucoes`. Cada
linha ativa relaciona empresa, filial e conta contábil com banco, agência e conta bancária, além
de formatos autorizados e tolerâncias de data e valor.

A aplicação valida campos obrigatórios, tolerâncias, contas ativas e relacionamentos duplicados.

**Motivo:** a equipe contábil pode ajustar contas e tolerâncias sem alterar código, e cada conta
tem uma relação explícita entre os dois lados da conciliação.

### Passo 6 — Descoberta, nomenclatura, período e identidade dos arquivos

Foram estabelecidos nomes padronizados:

```text
RAZAO_EMPRESA_FILIAL_AAAAMM.csv
RAZAO_EMPRESA_FILIAL_AAAAMM.xlsx
EXTRATO_BANCO_AGENCIA_CONTA_AAAAMM.csv
EXTRATO_BANCO_AGENCIA_CONTA_AAAAMM.xlsx
EXTRATO_BANCO_AGENCIA_CONTA_AAAAMM.ofx
EXTRATO_BANCO_AGENCIA_CONTA_AAAAMM.pdf
```

Na descoberta, a aplicação:

1. ignora arquivos temporários do sistema e do Excel;
2. valida nome e extensão;
3. compara a competência do nome com `--periodo`;
4. rejeita arquivos vazios;
5. calcula SHA-256;
6. detecta conteúdo duplicado dentro da mesma entrada;
7. consulta o manifesto para detectar conteúdo já processado.

**Motivo:** o nome fornece a identidade operacional que alguns arquivos não carregam internamente,
e o hash identifica o conteúdo mesmo quando o arquivo é renomeado.

### Passo 7 — Leitores de razão e extratos tabulares

Foram implementados leitores para:

- razão CSV;
- razão XLSX;
- extrato CSV;
- extrato XLSX;
- extrato OFX 1.x e 2.x com movimentos `STMTTRN`.

CSV aceita os delimitadores `;`, `,`, tabulação ou `|`, com UTF-8, UTF-8 com BOM ou Latin-1. OFX
tem um adaptador pequeno e controlado para os campos necessários, inclusive variantes SGML que não
são XML estrito.

Cada linha válida vira um registro normalizado. Uma linha inválida vira um erro técnico com
arquivo, linha, código, descrição e orientação, sem eliminar as outras linhas válidas.

**Motivo:** recuperação parcial é mais útil que abortar um lote inteiro por um único registro ruim,
desde que a rejeição fique visível no relatório.

### Passo 8 — Adaptação do razão Protheus aos arquivos reais

Os primeiros leitores assumiam uma tabela simples na primeira aba. Os arquivos reais mostraram
que relatórios do Protheus podem ter parâmetros, totais, múltiplas abas e cabeçalhos paginados.
Foram então acrescentados:

- busca do melhor cabeçalho nas primeiras 25 linhas de todas as abas;
- aliases `FILIAL DE ORIGEM` e `LOTE/SUB/DOC/LINHA`;
- uso de empresa e filial do nome padronizado quando não existem como colunas;
- leitura de conta contábil em uma linha de metadados `CONTA - ...`;
- descarte de cabeçalhos repetidos no meio do relatório paginado;
- preservação do número real da linha como evidência;
- perfil específico de sinal para o relatório bancário analítico do Protheus.

No leitor genérico de débito/crédito, o valor canônico continua sendo `crédito - débito`. No perfil
real identificado do relatório Protheus usado no piloto, a convenção necessária para comparar com
o extrato é `débito - crédito`. Essa diferença é detectada pelo perfil, não configurada manualmente
em cada linha.

**Motivo:** o sinal precisa representar o mesmo fluxo nos dois lados. Aplicar uma fórmula única a
layouts semanticamente diferentes faria movimentos corretos parecerem opostos.

### Passo 9 — Motor de conciliação um-para-um

O motor recebe somente modelos normalizados e aplica as regras na seguinte ordem:

| Ordem | Regra | Condição principal | Resultado |
|---:|---|---|---|
| 1 | Correspondência exata | documento, data e valor compatíveis | `CONCILIADO_EXATO` |
| 2 | Tolerância de data | documento e valor compatíveis; diferença de data dentro da tolerância | `CONCILIADO_TOLERANCIA_DATA` |
| 3 | Valor e data sem documento | um dos documentos ausente; valor e data compatíveis | `CONCILIADO_VALOR_DATA` |
| 4 | Divergência de valor | documento e data compatíveis; valor fora da tolerância | `DIVERGENCIA_VALOR` |
| 5 | Divergência de data | documento e valor compatíveis; data fora da tolerância | `DIVERGENCIA_DATA` |
| 6 | Razão sem extrato | nenhum movimento bancário consumido corresponde | `RAZAO_SEM_EXTRATO` |
| 7 | Extrato sem razão | nenhum lançamento contábil consumido corresponde | `EXTRATO_SEM_RAZAO` |
| 8 | Ambiguidade | mais de um candidato atende à regra | `MULTIPLAS_CORRESPONDENCIAS` |
| 9 | Possível duplicidade | mesma assinatura relevante aparece mais de uma vez na origem | `POSSIVEL_DUPLICIDADE` |

Quando uma correspondência única é aceita, os dois registros são marcados como usados. Eles não
podem ser usados novamente por outra regra. Quando há mais de um candidato, o motor não escolhe
o primeiro: registra a ambiguidade e conserva os candidatos para revisão.

**Motivo:** a ordem privilegia evidências fortes. A regra sem documento só é considerada depois das
regras com documento, e uma pendência humana é preferível a uma conciliação automática incorreta.

### Passo 10 — Relatório Excel auditável

O arquivo gerado contém oito abas:

1. `Resumo` — saldos, diferenças, quantidades, valores e status por conta;
2. `Conciliados` — os dois lados, regra aplicada, tolerâncias e diferenças;
3. `Divergencias_Detalhadas` — evidência lado a lado e campos para tratamento;
4. `Razao_Sem_Extrato` — lançamentos contábeis sem par;
5. `Extrato_Sem_Razao` — movimentos bancários sem par;
6. `Ambiguidades` — candidatos múltiplos e possíveis duplicidades;
7. `Arquivos_Processados` — hash, contagens, totais e métricas de importação;
8. `Erros_Tecnicos` — etapa, código, descrição, linha e orientação.

As planilhas têm filtros, cabeçalhos congelados, estilos e validação para situação de análise
humana. O resumo é calculado a partir dos mesmos resultados usados nas abas detalhadas.

Texto vindo de arquivo que começa por `=`, `+`, `-` ou `@` é neutralizado antes de ser gravado no
Excel para evitar injeção de fórmula.

**Motivo:** o Excel é simultaneamente entrega operacional e evidência de auditoria. Derivar o resumo
dos detalhes evita manter duas versões independentes do mesmo resultado.

### Passo 11 — Orquestração, recuperação parcial e arquivamento

O comando mensal executa esta sequência:

1. valida a competência;
2. cria as pastas ausentes;
3. abre e valida a configuração;
4. descobre e classifica as entradas;
5. verifica hashes já processados;
6. lê os arquivos e acumula registros e erros;
7. valida o relacionamento das contas;
8. executa o motor por conta ativa;
9. gera o Excel;
10. confere e arquiva arquivos aceitos em `02_Processados/AAAA-MM`;
11. move rejeitados para `03_Pendencias/AAAA-MM`;
12. atualiza o manifesto de hashes de forma atômica;
13. finaliza o log com contagens, status e duração.

Se uma falha crítica ocorrer antes do arquivamento, as entradas permanecem onde estavam. Após mover
um arquivo aceito, seu hash é recalculado e comparado ao original.

**Motivo:** a ausência de banco de dados exige uma ordem de efeitos cuidadosamente controlada. O
relatório salvo é a confirmação de que existe uma evidência antes de mudar o estado das entradas.

### Passo 12 — Reprocessamento explícito e sem sobrescrita

O arquivo `02_Processados/processed_hashes.json` guarda hash, nome original, destino, período,
instante e indicação de reprocessamento. Se o hash já foi visto, a execução falha por padrão.

O operador pode usar `--reprocessar` quando a repetição for deliberada. Nesse caso, relatórios e
arquivos arquivados recebem um sufixo com data, hora e microssegundos. Nada anterior é sobrescrito.

**Motivo:** uma rotina mensal precisa ser idempotente, mas também precisa permitir correção e
auditoria de uma nova execução sem destruir o histórico.

### Passo 13 — Log e proteção de dados

Cada execução gera um log próprio com versão, início, fim, usuário/máquina, período, quantidade de
arquivos, registros, totais, status, regras e duração. Contas bancárias presentes em nomes de
extratos são mascaradas no log, preservando apenas os últimos quatro caracteres úteis.

O relatório formal e o manifesto mantêm a identidade necessária à auditoria, mas o log evita
repetir desnecessariamente o número completo da conta.

**Motivo:** observabilidade é necessária para suporte e auditoria, porém logs tendem a ser copiados
e compartilhados com mais frequência e devem minimizar exposição de dados.

### Passo 14 — Distribuição para Windows

Foram mantidas três formas de execução:

- pacote Python durante desenvolvimento;
- `executar_conciliacao.bat` para escolher automaticamente o executável ou a `.venv`;
- `dist/conciliacao.exe`, gerado pelo PyInstaller em modo `onefile`.

O build exclui dependências que não são usadas, como Pandas e NumPy. O executável atual tem cerca
de 24,8 MB e foi validado com `--help`, `init` e fluxo completo sintético.

**Motivo:** desenvolvedores preservam um ambiente testável, enquanto o usuário final pode executar
sem instalar Python.

---

## 5. Implementação do suporte a PDF e OCR

### 5.1 Por que o PDF exigiu uma camada separada

PDF não é uma tabela. Um arquivo pode conter texto pesquisável, imagens, fontes com mapeamento
incorreto, cabeçalhos repetidos, descrições quebradas e posições visuais sem separadores claros.
Por isso, a leitura foi dividida em responsabilidades:

```text
PdfStatementReader
  -> valida arquivo e extrai cada página
  -> usa OCR apenas quando o texto direto é insuficiente

BankLayoutDetector
  -> escolhe um parser específico conhecido
  -> tenta o parser genérico estrito por último

Parser
  -> transforma linhas em BankStatement/BankTransaction

PdfStatementImportService
  -> valida período, conta, saldos e registros
  -> converte para o mesmo ReadResult dos outros formatos
```

O motor de conciliação não importa `pypdf` e não conhece OCR.

### 5.2 Validações antes da leitura

O leitor confere:

- existência e extensão `.pdf`;
- arquivo não vazio;
- assinatura real `%PDF-`;
- tamanho máximo;
- PDF não corrompido;
- ausência de senha;
- quantidade de páginas maior que zero e dentro do limite;
- tempo total dentro do timeout.

**Motivo:** validar cedo produz mensagens claras, evita consumo excessivo de recursos e impede que
um arquivo apenas renomeado como PDF avance para o parser.

### 5.3 Extração página a página

O `pypdf` tenta extrair texto preservando o layout. Se a página alcançar o comprimento mínimo de
texto significativo, ela é marcada como `TEXT` com confiança de 100%. Se não alcançar, ela é
classificada para OCR.

Um documento pode terminar como `TEXT`, `OCR` ou `MIXED`. Falha isolada em uma página é registrada
sem necessariamente descartar páginas válidas do mesmo arquivo.

**Motivo:** a origem por página permite explicar exatamente de onde veio cada movimento e evita
aplicar OCR caro e potencialmente menos preciso ao documento inteiro.

### 5.4 OCR com Poppler e Tesseract

Quando habilitado, o adaptador:

1. copia o PDF para um diretório temporário com nome sanitizado;
2. renderiza apenas a página necessária em PNG com `pdftoppm`;
3. usa 250 DPI por padrão;
4. executa o Tesseract em formato TSV;
5. reconstrói linhas e calcula a confiança média das palavras;
6. registra alerta quando a confiança fica abaixo do limite;
7. remove o diretório temporário ao finalizar.

Os subprocessos são chamados por lista fixa de argumentos, sem `shell`, com captura de saída e
timeout. Caminhos de comandos podem ser configurados, mas nenhum conteúdo do PDF vira comando.

**Motivo:** o protocolo de OCR pode ser substituído nos testes e no futuro. O isolamento reduz
riscos e torna falhas ambientais controláveis.

### 5.5 Configuração do PDF

As variáveis disponíveis são:

| Variável | Padrão | Finalidade |
|---|---:|---|
| `PDF_MAX_FILE_SIZE_MB` | `25` | limite de tamanho |
| `PDF_MAX_PAGES` | `100` | limite de páginas |
| `PDF_EXTRACTION_TIMEOUT_SECONDS` | `120` | timeout da leitura/OCR |
| `PDF_ENABLE_OCR` | `NAO` | autorização explícita do OCR |
| `PDF_OCR_LANGUAGE` | `por` | idioma do Tesseract |
| `PDF_OCR_DPI` | `250` | resolução da página renderizada |
| `PDF_MIN_TEXT_LENGTH` | `40` | limiar de texto pesquisável |
| `PDF_OCR_MIN_CONFIDENCE` | `70` | limiar de alerta de confiança |
| `PDF_TEMP_DIRECTORY` | vazio | pasta temporária opcional |
| `PDF_OCR_COMMAND` | `tesseract` | executável ou caminho do Tesseract |
| `PDF_RENDER_COMMAND` | `pdftoppm` | executável ou caminho do Poppler |

Os padrões estão documentados em `.env.example`; a aplicação lê variáveis do ambiente e valida
inteiros, booleanos e confiança antes do processamento.

### 5.6 Parsers implementados

Foram implementados três perfis:

- `ITAU_TEXTO_V1`: extrato Itaú pesquisável;
- `ITAU_EMPRESAS_OCR_V1`: tabela contínua do Itaú Empresas obtida por OCR;
- `GENERICO_TABELAR_V1`: fallback que só aceita cabeçalho inequívoco de data, descrição e valor.

O parser trata:

- datas completas e datas sem ano quando o período foi identificado;
- marcadores `C`, `D`, `CR` e `DB`;
- sinais antes ou depois do valor;
- separadores de milhar e decimal com ruído controlado;
- descrições em mais de uma linha ou página;
- cabeçalhos e rodapés repetidos;
- saldo inicial e final quando disponíveis;
- competência solicitada;
- arquivo, página, texto original, parser, método e confiança.

Layout desconhecido não gera transações. O arquivo é rejeitado com orientação para homologar um
novo parser usando uma fixture anonimizada.

### 5.7 Correções específicas descobertas com o PDF real

O extrato real revelou problemas que fixtures simples não mostravam:

- a renderização em 200 DPI perdia linhas densas; o padrão passou a 250 DPI;
- movimentos legitimamente idênticos eram removidos por deduplicação de conteúdo; os IDs passaram
  a considerar a ocorrência no documento;
- ruído como `MAIS. 17,28` podia perder a separação do valor; a normalização foi restringida para
  conservar o limite entre descrição e quantia;
- linhas de resumo como `SALDO 1,00` podiam parecer transações; saldos e totalizadores passaram a
  ser ignorados pelo extrator de movimentos;
- lançamentos fora da competência solicitada passaram a ser filtrados;
- nomes de conta com hífen precisaram de máscara mais robusta no log.

**Motivo:** esses ajustes não tornam o parser genericamente permissivo. Eles documentam padrões
observados e são protegidos por testes de regressão sintéticos.

---

## 6. Testes e processo de qualidade

O desenvolvimento foi organizado em fatias testáveis, seguindo RED, GREEN e REFACTOR:

1. escrever o comportamento esperado;
2. observar o teste falhar pelo motivo correto;
3. implementar a menor solução correta;
4. refatorar mantendo a suíte verde;
5. executar a suíte completa antes de avançar.

### 6.1 Tipos de teste

- **Unitários:** dinheiro, datas, documentos, modelos, configurações, parser PDF e regras 1 a 9.
- **Integração:** configuração XLSX, descoberta, CSV, XLSX, OFX, PDF, OCR injetável e Excel.
- **End-to-end:** estrutura mensal completa, relatório, log, manifesto, arquivamento e
  reprocessamento.
- **Segurança e regressão:** formula injection, hashes, nomes, limites de PDF, senha, corrupção,
  timeout, conta mascarada e preservação dos bytes originais.

### 6.2 Fixtures PDF

Existem PDFs sintéticos estruturalmente reais para:

- PDF pesquisável;
- PDF composto somente por imagens;
- PDF multipágina;
- PDF inválido ou protegido;
- layout não suportado.

O OCR é testado por um adaptador determinístico injetado sobre PDFs image-only. Assim, a CI valida
a decisão de usar OCR, confiança, falha parcial e integração sem depender de uma instalação local
do Tesseract.

### 6.3 Estado de qualidade verificado em 1º de agosto de 2026

| Verificação | Resultado atual |
|---|---|
| Pytest | 83 testes aprovados |
| Cobertura combinada de linhas e branches | 87,87%, acima do mínimo de 85% |
| `ruff check .` | aprovado |
| `ruff format --check .` | 42 arquivos formatados |
| Executável Windows | presente e validado em smoke/fluxos representativos |
| CI | lint, formatação, testes e build em `windows-latest` |

---

## 7. Validação com os arquivos reais fornecidos

Os arquivos reais não foram adicionados ao Git. Eles foram copiados para workspaces locais de
teste, renomeados conforme o contrato operacional e processados sem alteração de conteúdo.

### 7.1 Primeiro conjunto real — competência 2026-02

O processamento final importou:

- 676 lançamentos válidos do razão;
- 731 movimentos válidos do extrato;
- 269 conciliações automáticas;
- 3 alertas de importação/OCR para revisão;
- relatório com divergências e ausências preservadas.

Esse teste confirmou a integração real entre XLSX Protheus, PDF digitalizado, OCR, parser Itaú,
motor e relatório.

### 7.2 Conjunto histórico correto — competência 2025-12

O segundo conjunto foi informado como uma conciliação passada correta e, por isso, foi usado como
baseline de comparação. O processamento final observou:

| Métrica | Resultado |
|---|---:|
| Lançamentos do razão | 2.056 |
| Movimentos do extrato | 1.723 |
| Registros válidos totais | 3.779 |
| Arquivos rejeitados | 0 |
| Erros/alertas de importação | 0 |
| Conciliações automáticas um-para-um | 562 |
| Valor conciliado | R$ 38.620.145,42 |
| Razão sem extrato após as regras atuais | 378 |
| Extrato sem razão após as regras atuais | 209 |
| Saldo líquido do razão | R$ 1.469.012,32 |
| Saldo líquido do extrato | R$ 1.469.012,30 |
| Diferença líquida | R$ 0,02 |

O relatório final está no workspace local em:

```text
runtime/historical_baseline_202512/04_Resultados/2025-12/
CONCILIACAO_SPREAD_202512_REPROC_20260731_202152_356368.xlsx
```

O fechamento líquido praticamente exato confirma que os dois arquivos representam o mesmo
universo financeiro e que a leitura dos sinais e totais foi corrigida. Ao mesmo tempo, a quantidade
de pendências individuais mostra a limitação atual do algoritmo: o histórico contém movimentos que
foram agrupados ou desmembrados entre razão e banco, enquanto o motor só aceita um lançamento de
cada lado por conciliação.

Possíveis duplicidades também são deliberadamente destacadas para revisão. Um movimento idêntico
não é mais apagado durante a importação do PDF, mas duas ocorrências com a mesma assinatura podem
ser sinalizadas pelo motor como `POSSIVEL_DUPLICIDADE`. Preservar e sinalizar é mais seguro do que
descartar.

---

## 8. O que os testes reais mudaram na aplicação

Antes do piloto, a implementação atendia aos contratos sintéticos. Os arquivos reais ampliaram a
robustez em pontos concretos:

1. **Localização do cabeçalho do razão:** deixou de assumir a primeira linha e a primeira aba.
2. **Conta contábil:** passou a aceitar a conta em metadados do relatório paginado.
3. **Cabeçalhos repetidos:** passaram a ser ignorados sem gerar erros falsos.
4. **Sinal do Protheus:** foi ajustado por perfil ao sentido realmente comparável ao extrato.
5. **Layout Itaú Empresas:** ganhou parser próprio para OCR, separado do Itaú textual.
6. **Qualidade do OCR:** passou de 200 para 250 DPI por padrão.
7. **Movimentos idênticos legítimos:** deixaram de ser removidos na importação.
8. **Ruído de OCR em valores:** a expressão de parsing ficou mais precisa.
9. **Linhas de saldo:** deixaram de ser classificadas como movimentos.
10. **Competência:** movimentos históricos fora do mês solicitado passaram a ser filtrados.
11. **Privacidade do log:** a máscara passou a cobrir também contas com hífen.

Cada defeito reproduzível foi transformado em teste sintético. Assim, as correções continuam
verificáveis sem armazenar os arquivos confidenciais no repositório.

---

## 9. Mapa dos módulos

| Arquivo/módulo | Responsabilidade |
|---|---|
| `src/conciliacao/models.py` | contratos e tipos do domínio |
| `src/conciliacao/normalization.py` | dinheiro, datas, documentos, códigos e cabeçalhos |
| `src/conciliacao/config.py` | template e validação da planilha de contas |
| `src/conciliacao/discovery.py` | nomes, competência, formatos, SHA-256 e duplicidade de arquivos |
| `src/conciliacao/adapters.py` | razão CSV/XLSX e extratos CSV/XLSX/OFX/PDF |
| `src/conciliacao/pdf_statements/settings.py` | limites e configuração ambiental do PDF/OCR |
| `src/conciliacao/pdf_statements/extraction.py` | validação, pypdf, detecção de imagem e Tesseract |
| `src/conciliacao/pdf_statements/parsers.py` | detector e parsers Itaú/genérico |
| `src/conciliacao/pdf_statements/service.py` | validação e conversão do PDF ao modelo comum |
| `src/conciliacao/reconciliation.py` | regras 1 a 9 e controle de unicidade |
| `src/conciliacao/reporting.py` | Excel de oito abas e proteção contra fórmulas |
| `src/conciliacao/processing.py` | caso de uso mensal, log, manifesto e arquivamento |
| `src/conciliacao/cli.py` | comandos `init` e `run` |
| `scripts/build_executable.ps1` | build do executável Windows |
| `tests/` | testes unitários, integração, E2E e fixtures |

---

## 10. Como executar a solução

### 10.1 Criar a estrutura

Com o executável:

```powershell
.\dist\conciliacao.exe init --base-dir C:\Conciliacao
```

Ou pelo código-fonte:

```powershell
.\.venv\Scripts\python.exe -m conciliacao init --base-dir C:\Conciliacao
```

### 10.2 Configurar as contas

Abra:

```text
C:\Conciliacao\05_Configuracao\CONFIGURACAO_CONTAS.xlsx
```

Preencha ao menos uma linha ativa na aba `Contas`, salve e feche o Excel.

### 10.3 Preparar a competência

Coloque o razão em `01_Entrada/Razao` e o extrato em `01_Entrada/Extratos`, usando a nomenclatura
padronizada.

Para PDF digitalizado, Poppler e Tesseract precisam estar instalados. Habilite no PowerShell da
execução:

```powershell
$env:PDF_ENABLE_OCR = "SIM"
$env:PDF_OCR_LANGUAGE = "por"
```

Se o pacote de idioma português não estiver instalado no Tesseract homologado, configure um idioma
disponível conscientemente; isso pode alterar a qualidade do OCR.

### 10.4 Executar o mês

```powershell
.\dist\conciliacao.exe run --base-dir C:\Conciliacao --periodo 202512
```

Para reprocessar conteúdo já conhecido:

```powershell
.\dist\conciliacao.exe run --base-dir C:\Conciliacao --periodo 202512 --reprocessar
```

### 10.5 Revisar o resultado

Comece por `Resumo`, depois revise `Divergencias_Detalhadas`, `Razao_Sem_Extrato`,
`Extrato_Sem_Razao`, `Ambiguidades` e `Erros_Tecnicos`. Use `Arquivos_Processados` para confirmar
hashes, quantidades e qualidade da importação.

---

## 11. Limitações atuais e por que elas permanecem

### 11.1 Conciliação apenas um-para-um

O motor não soma vários lançamentos do razão para comparar com um movimento bancário, nem divide
um lançamento do razão entre vários movimentos. Isso explica a diferença entre um saldo global que
fecha e uma quantidade relevante de itens individuais pendentes.

**Por que ainda não foi implementado:** agrupamentos aumentam muito o espaço de combinações e o
risco de falso positivo. A próxima versão precisa definir janelas de data, limites de quantidade,
uso de histórico/documento, tolerância de soma, prioridade e evidência específica antes de
automatizar esse comportamento.

### 11.2 Cobertura de layouts PDF

Há parsers específicos para os layouts Itaú identificados e um fallback genérico estrito. Outros
bancos ou mudanças significativas de layout são rejeitados.

**Por que:** um parser permissivo pode criar transações que não existem. Cada novo layout deve ser
homologado com uma fixture anonimizada e testes próprios.

### 11.3 Dependências externas de OCR

O executável Python não incorpora Poppler, Tesseract nem os pacotes de idioma. Eles precisam ser
instalados e homologados na máquina operacional.

**Por que:** são binários externos com licenciamento, tamanho e configuração próprios. Mantê-los
separados torna a aplicação mais previsível e permite que a empresa controle a instalação.

### 11.4 Aceite contábil e desempenho operacional

A solução passou por testes automatizados e dois conjuntos reais, mas a aprovação formal do
processo exige uso paralelo em fechamentos controlados e decisão do responsável contábil. A meta de
tempo também deve ser medida com o volume e o hardware da operação.

### 11.5 Sem interface gráfica ou workflow

O produto atual termina no Excel e não possui aprovação eletrônica, comentários centralizados,
histórico em banco ou painel web.

**Por que:** essas capacidades só agregam valor depois que as regras e os layouts estiverem
homologados no piloto.

---

## 12. Próxima evolução recomendada

A evolução de maior valor é um motor de agrupamentos controlados, mantendo o comportamento atual
como primeira fase. A ordem recomendada é:

1. medir e classificar manualmente as pendências do baseline 2025-12;
2. identificar padrões reais de um-para-muitos e muitos-para-um;
3. definir limites conservadores por conta;
4. criar fixtures sintéticas para cada padrão;
5. implementar busca de combinações com limite de tamanho e tempo;
6. exigir correspondência única da combinação;
7. criar status e evidência próprios no Excel;
8. comparar novamente com a conciliação histórica correta;
9. submeter o resultado ao responsável contábil antes de habilitar automaticamente.

Depois disso, a segunda prioridade é homologar parsers para os demais bancos e layouts reais.

---

## 13. Conclusão

A implementação entregue cobre o ciclo técnico completo do MVP: preparação, configuração,
descoberta, validação, importação, PDF/OCR, normalização, conciliação, evidência, log, integridade,
arquivamento, reprocessamento, testes, CI e executável Windows.

A decisão central do projeto foi privilegiar auditabilidade e segurança sobre quantidade de
conciliações automáticas. A aplicação nunca deve fabricar um movimento, escolher um candidato
ambíguo ou esconder um erro para aumentar artificialmente a taxa de conciliação.

Os testes com os arquivos históricos confirmaram a leitura dos dados e, ao mesmo tempo, mostraram
com precisão a próxima fronteira funcional: conciliar agrupamentos de maneira tão rastreável e
conservadora quanto o fluxo um-para-um atual.
