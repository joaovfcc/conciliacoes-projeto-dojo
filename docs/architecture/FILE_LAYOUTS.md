# Contratos de configuração e arquivos

## Configuração — aba `Contas`

Cabeçalhos obrigatórios: `Empresa`, `Filial`, `Conta contábil`, `Descrição`, `Banco`, `Agência`,
`Conta bancária`, `Formato aceito`, `Tolerância de data`, `Tolerância de valor`,
`Regra principal` e `Ativa`. `Responsável` é opcional.

- `Formato aceito`: uma lista como `CSV,XLSX,OFX,PDF`.
- `Tolerância de data`: inteiro não negativo em dias.
- `Tolerância de valor`: número monetário, por exemplo `0,01`.
- `Ativa`: `SIM` ou `NAO`.
- Banco, agência, conta bancária e conta contábil são evidências de origem; não há relacionamento obrigatório entre
  elas para conciliar os movimentos da empresa.

A aba `Parametros` é criada com período/tolerâncias gerais e autorização de reprocessamento.
Nesta versão, tolerâncias por conta e a opção explícita da CLI são autoritativas. A aba
`Layouts` é reservada para novos adaptadores homologados.

## Razão CSV/XLSX

Campos canônicos obrigatórios:

| Campo | Aliases aceitos | Regra |
|---|---|---|
| Empresa | `EMPRESA`, `COD_EMPRESA` | não vazio |
| Filial | `FILIAL`, `COD_FILIAL` | não vazio |
| Conta contábil | `CONTA_CONTABIL`, `CONTA`, `CT2_DEBITO`, `CT2_CREDIT` | deve estar configurada |
| Data | `DATA`, `DT_LANCAMENTO`, `DATA_LANCAMENTO` | deve pertencer ao período |
| Valor | `VALOR`, `VALOR_LIQUIDO` | alternativa ao par débito/crédito |
| Débito + Crédito | `DEBITO`/`VALOR_DEBITO`, `CREDITO`/`VALOR_CREDITO` | valor = crédito - débito |

Campos opcionais: `DOCUMENTO`/`DOC`/`NUM_DOCUMENTO`, `HISTORICO`/`DESCRICAO` e
`IDENTIFICADOR`/`ID`/`ID_PROTHEUS`. A aplicação cria ID, arquivo e linha de origem quando não
vierem informados.

Exemplo CSV:

```csv
Empresa;Filial;Conta contábil;Data;Documento;Histórico;Débito;Crédito;Identificador
SPREAD;MATRIZ;1.1.1.01.001;28/07/2026;001;PAGAMENTO;100,00;0;L1
```

## Extrato CSV/XLSX

`Data` e `Valor` são obrigatórios. `Documento`, `Histórico` e `Identificador bancário` são
opcionais, com os aliases da seção anterior e `FITID`/`ID_BANCARIO`. Banco, agência e conta são
obtidos do conteúdo quando disponíveis e preservados como evidência, sem restringir a conciliação.

Exemplo CSV:

```csv
Data;Documento;Histórico;Valor;Identificador bancário
28/07/2026;001;PAGAMENTO;-100,00;FIT-1
```

## Extrato OFX

Cada movimento deve estar em `STMTTRN` e conter `DTPOSTED` e `TRNAMT`. `FITID`,
`CHECKNUM`/`REFNUM` e `MEMO`/`NAME` são opcionais. O leitor aceita OFX SGML 1.x sem tags de
fechamento individuais e OFX XML que preserve esses blocos.

## Extrato PDF

Nome: `EXTRATO_BANCO_AGENCIA_CONTA_AAAAMM.pdf`. O arquivo deve ter assinatura `%PDF`, não pode
estar protegido e deve respeitar os limites `PDF_*`.

O PDF é identificado pelo conteúdo e encaminhado exclusivamente a um parser homologado: conta
corrente Bradesco, BRB, Itaú, Santander ou Sofisa; atividade de investimento Bradesco, Itaú ou
Santander; ou posição de renda fixa Sofisa. Não existe fallback genérico para tabela PDF, pois uma
coluna de saldo nunca pode ser interpretada como lançamento.

Conta corrente gera somente movimentos com data, documento opcional, descrição, valor e evidência.
Datas sem ano usam o período extraído do cabeçalho; sinais posteriores e sinais separados são
normalizados. Conta corrente reconhecida sem movimentos é válida e gera o aviso
`EXTRATO_SEM_MOVIMENTOS`.

Atividade de investimento gera aplicações, resgates e rendimentos exclusivamente informativos.
Posição Sofisa gera o saldo final informativo. Nenhum documento de investimento pode ser associado
ao razão ou entrar na conciliação um a um.

Cada registro conserva arquivo, página, trecho, método (`TEXTO`, `OCR` ou `MISTO`), parser,
confiança e avisos. PDF digitalizado exige Poppler e Tesseract com o idioma português `por`.
Se OCR não estiver disponível, a resposta é `PDF_OCR_UNAVAILABLE`; conteúdo desconhecido é
`PDF_LAYOUT_UNSUPPORTED` e PDF inválido é `PDF_INVALID`.

O razão Protheus analítico em XLSX pode conter abas de parâmetros e totalizadores. O leitor procura
o cabeçalho contábil nas primeiras linhas de todas as abas, reconhece `FILIAL DE ORIGEM` e
`LOTE/SUB/DOC/LINHA`, preserva a linha real e aplica `débito - crédito` nesse perfil bancário.
Relatórios paginados também podem informar a conta apenas na linha `CONTA - ...`; nesse caso, o
leitor extrai a conta dos metadados e ignora os cabeçalhos repetidos entre os lançamentos.

## Tipos, sinais e rastreabilidade

- datas: `DD/MM/AAAA`, `AAAA-MM-DD`, `DD-MM-AAAA`, `AAAAMMDD` ou célula de data XLSX;
- valores: `1.234,56`, `1,234.56`, negativos e `(1.500,25)`;
- razão com débito/crédito: débito se torna negativo e crédito positivo;
- extrato: o sinal do arquivo é preservado;
- documento: caixa/pontuação são normalizadas, zeros à esquerda são preservados;
- identificador de origem: é preservado como texto, inclusive hífens;
- uma linha inválida é registrada sem descartar linhas válidas do mesmo arquivo.
