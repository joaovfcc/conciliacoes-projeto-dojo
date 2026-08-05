# Arquitetura

## Stack e decisão

Python 3.11+ foi escolhido por portabilidade no Windows e ótimo suporte a arquivos. OpenPyXL
faz leitura/escrita XLSX; pypdf lê PDF por página; CSV, XML/OFX, hash, logs e movimentação usam
a biblioteca padrão.
Pytest mede comportamento e cobertura; Ruff reúne lint e formatação. Pandas foi considerado,
mas dispensado: o fluxo por registros é menor, mantém `Decimal` sem coerções e reduz o pacote
do executável. Banco, Docker e servidor web não agregam valor ao MVP local.

## Módulos e fluxo

```text
CLI -> configuração/descoberta -> adaptadores -> registros normalizados
    -> motor de conciliação -> relatório Excel -> arquivamento/manifesto
                         \-> log técnico

PDF -> PdfStatementReader -> extração direta por página
                         \-> OCR por página (fallback configurável)
    -> BankLayoutDetector -> parser específico ou genérico conservador
    -> normalização -> validação -> ReadResult comum
```

- `models`: contratos imutáveis e enumerações do domínio.
- `config`: validação da planilha e criação do template operacional.
- `discovery`: convenções de nomes, períodos, temporários e hashes.
- `adapters`: leitores independentes de razão, banco tabular, OFX e despacho de PDF.
- `pdf_statements.extraction`: assinatura, limites, texto, detecção de digitalização e OCR.
- `pdf_statements.parsers`: detector extensível, parser Itaú e fallback genérico.
- `pdf_statements.service`: normalização, validação e relatório da importação.
- `reconciliation`: regras ordenadas, unicidade e classificação.
- `reporting`: Excel cuja aba Resumo é derivada dos detalhes.
- `processing`: caso de uso transacional, recuperação parcial e arquivamento.
- `cli`: comandos `init` e `run`, sem regras de negócio.

## Configuração e erros

A configuração operacional permanece em XLSX e a técnica em argumentos/variáveis de ambiente.
Os oito limites e opções `PDF_*` têm padrões seguros e validação na inicialização do leitor.
Erros possuem código, etapa, arquivo, linha e orientação. Falhas de registro são acumuladas;
falhas de configuração ou geração do relatório são críticas e preservam as entradas.

## Observabilidade

Cada execução recebe ID, horários e log próprio. São registrados arquivos/hashes, contagens,
totais, status, duração e falhas, nunca credenciais ou conteúdo financeiro integral.

## Segurança e integridade

- caminhos são resolvidos dentro da raiz informada e nomes externos nunca viram comandos;
- extensões, tamanho, nomenclatura, período e cabeçalhos são validados;
- fórmulas provenientes das entradas são gravadas como texto para evitar formula injection;
- arquivos originais são lidos sem escrita e têm hash antes do arquivamento;
- não há rede, execução dinâmica, credenciais ou dados reais nas fixtures;
- PDFs validam extensão, assinatura, tamanho, páginas e tempo; cópias temporárias têm nome
  sanitizado e são apagadas ao sair do contexto;
- OCR usa `subprocess` sem shell, lista fixa de argumentos e timeout; conta bancária é mascarada
  no log, embora permaneça integral na evidência formal do workbook;
- o manifesto de hashes e outputs versionados promovem idempotência.

## Estratégia de testes e evolução

O domínio puro recebe muitos testes unitários; adaptadores, Excel, arquivamento e CLI recebem
testes de integração; um fluxo temporário completo atua como E2E. PDFs estruturalmente reais
são renderizados na validação e cobrem texto, imagens, proteção, corrupção e múltiplas páginas.
Um novo banco implementa `BankStatementParser` sem alterar extração ou motor. Persistência e
interface gráfica só serão avaliadas
depois do piloto.
