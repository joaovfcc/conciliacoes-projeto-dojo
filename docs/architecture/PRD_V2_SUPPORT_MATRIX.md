# Matriz de suporte do PRD V2

Esta matriz é derivada do inventário privado executado em 2026-08-10. O artefato privado contém
somente hash SHA-256, classificação, família do parser e códigos de diagnóstico; não contém nomes,
contas, valores, texto ou dados de empresa.

Comando reproduzível por diretório (em ambiente autorizado):

```powershell
$env:PRIVATE_CORPUS_DIR = 'C:\caminho-privado\Extratos_12'
$env:PRIVATE_CORPUS_REPORT = 'C:\caminho-privado\private-corpus-inventory.json'
$env:PRIVATE_CORPUS_EXPECTED_PDFS = '68'
pnpm inventory:private-corpus
```

Para um arquivo compactado, use `PRIVATE_CORPUS_ZIP` no lugar de `PRIVATE_CORPUS_DIR`. Exatamente
uma das duas fontes deve ser informada. O relatório versão 2 registra somente hashes, identificadores
derivados, classificação, adapter e diagnósticos; caminho e nome original nunca são persistidos.

## Resultado do inventário

- 68 PDFs e 18 instituições inventariados.
- 32 PDFs foram extraídos, mas permanecem `PARSED_AWAITING_ORACLE`.
- 5 PDFs foram reconhecidos, porém falharam no gate de movimentos.
- 18 PDFs exigem OCR em português.
- 11 layouts textuais estão explicitamente sem adapter.
- 2 PDFs protegidos por senha são bloqueados com diagnóstico explícito.

“Pista de inventário” é derivada apenas do nome privado para agrupar a cobertura. Ela não é usada
pela detecção, pelo parser ou pela conciliação. “Detectado” é a identidade retornada pelo parser.

| Instituição (pista) | PDFs | Estado observado | Detectado pelo parser | Estado de suporte | Próxima unidade verificável |
|---|---:|---|---|---|---|
| ABC Brasil | 4 | 4 extraídos | 2 CC, 2 contas vinculadas | Dois adapters implementados, aguardando oráculo | Revisar oráculos e homologar controles de saldo |
| Banco do Brasil | 2 | 2 extraídos | 1 CC, 1 Rende Fácil | Dois adapters implementados, aguardando oráculo | Revisar oráculos e homologar os controles de saldo |
| BMG | 5 | 5 extraídos | 4 CC, 1 posição | Implementado, aguardando oráculo e saldo por movimento | Revisar oráculos e homologar o controle de saldo aplicável |
| BMP | 1 | 1 extraído | 1 CC | Adapter implementado, aguardando oráculo | Revisar oráculo e homologar controle de saldo acumulado |
| Bocom | 2 | 1 OCR pendente, 1 extraído | 1 CC analítica | Analítico implementado; vazio possui contrato e aguarda OCR | Revisar oráculo do analítico e executar o vazio com OCR `por` |
| Bradesco | 9 | 8 extraídos, 1 OCR pendente | 6 CC, 2 investimento | Implementado, aguardando oráculo e saldo | Controles de saldo e fixture por família |
| BRB | 1 | 1 reconhecido com gate de movimentos | 1 CC | Implementado, aguardando oráculo e correção | Homologar extração dos movimentos de referência |
| Caixa | 3 | 3 extraídos | 2 CC, 1 fundo | Dois adapters implementados, aguardando oráculos | Revisar oráculos e homologar os controles de saldo e investimento |
| Daycoval | 3 | 3 extraídos | 3 CC | Adapter implementado, aguardando oráculos | Revisar oráculos dos resultados com 13, 0 e 29 movimentos |
| Guanabara | 2 | 2 extraídos sem movimentos | 1 CC, 1 conta vinculada | Dois adapters implementados, aguardando oráculos | Confirmar saldos e ausência de movimentos nos oráculos |
| Itaú | 2 | 2 OCR pendentes | — | OCR não homologado | Habilitar OCR `por`, depois separar CC e Aplic Aut Mais |
| Paulista | 2 | 2 layouts não suportados | — | Sem adapter | Criar contrato/fixture do layout |
| Pine | 3 | 3 layouts não suportados | — | Sem adapter | Criar contrato/fixture do layout |
| Planner | 2 | 2 PDFs protegidos por senha | — | Bloqueado explicitamente | Exportar cópia sem proteção; não solicitar senha |
| Safra | 17 | 13 OCR pendentes, 4 layouts não suportados | — | Sem adapter | Primeiro CC; depois fundo, certificado, automático e nota |
| Santander | 2 | 1 extraído, 1 OCR pendente | 1 CC | Implementado, aguardando oráculo e saldo | Separar CC e investimento automático |
| Sofisa | 6 | 6 extraídos | 5 CC, 1 posição | Implementado, aguardando oráculo e saldo | Controle de saldo CC e posição de conferência |
| Vórtx | 2 | 2 layouts não suportados | — | Sem adapter | Conta corrente e carteira de debêntures separadamente |

## Matriz completa por família PDF

Esta é a unidade real de suporte. A matriz tipada equivalente vive em
`packages/core/src/corpus-support-matrix.ts`; testes impedem que uma das 36 famílias ou um dos 68
documentos seja removido silenciosamente.

| Lote | Instituição | Tipo | Família | Qtd. | Extração | Status atual |
|---:|---|---|---|---:|---|---|
| 1 | Bradesco | Conta-corrente | `BRADESCO_NET_EMPRESA_CC` | 7 | Texto/OCR | `PARTIAL_ADAPTER` |
| 1 | Bradesco | Investimento | `BRADESCO_NET_EMPRESA_INVEST` | 2 | Texto | `AWAITING_ORACLE` |
| 1 | BRB | Conta-corrente | `BRB_CC_DETALHADO` | 1 | Texto | `PARSER_DEFECT` |
| 1 | Itaú | Conta-corrente | `ITAU_EMPRESAS_CC` | 1 | OCR | `AWAITING_OCR` |
| 1 | Itaú | Aplicação | `ITAU_APLIC_AUT_MAIS` | 1 | OCR | `INFORMATIONAL_ONLY` |
| 1 | Santander | Conta-corrente | `SANTANDER_IBE_CC` | 1 | Texto | `PARTIAL_ADAPTER` |
| 1 | Santander | Aplicação | `SANTANDER_IBE_INVEST` | 1 | OCR | `INFORMATIONAL_ONLY` |
| 1 | Sofisa | Conta-corrente | `SOFISA_NET_CC` | 5 | Texto | `PARTIAL_ADAPTER` |
| 1 | Sofisa | Posição | `SOFISA_RENDA_FIXA_POSICAO` | 1 | Texto | `INFORMATIONAL_ONLY` |
| 2 | ABC Brasil | Conta-corrente | `ABC_CC_EXTRATO_DETALHADO` | 2 | Texto | `PARTIAL_ADAPTER` |
| 2 | ABC Brasil | Conta vinculada | `ABC_CONTA_VINCULADA` | 2 | Texto | `PARTIAL_ADAPTER` |
| 2 | Banco do Brasil | Conta-corrente | `BB_CC_CONSULTAS` | 1 | Texto | `PARTIAL_ADAPTER` |
| 2 | Banco do Brasil | Rende Fácil | `BB_RENDE_FACIL_RESUMO` | 1 | Texto | `AWAITING_ORACLE` |
| 2 | BMG | Conta-corrente | `BMG_CC_WEB` | 4 | Texto | `PARTIAL_ADAPTER` |
| 2 | BMG | Investimento | `BMG_POSICAO_RENDIMENTO` | 1 | Texto | `AWAITING_ORACLE` |
| 2 | BMP | Conta-corrente | `BMP_CC_EXTRATO` | 1 | Texto | `PARTIAL_ADAPTER` |
| 3 | Bocom | Conta-corrente sem movimentos | `BOCOM_CC_EMPTY` | 1 | OCR | `AWAITING_OCR` |
| 3 | Bocom | Conta-corrente analítica | `BOCOM_CC_ANALITICO` | 1 | Texto | `PARTIAL_ADAPTER` |
| 3 | Caixa | Conta-corrente | `CAIXA_CC_EXTRATO_PERIODO` | 2 | Texto | `PARTIAL_ADAPTER` |
| 3 | Caixa | Fundo | `CAIXA_FUNDO_EXTRATO` | 1 | Texto | `AWAITING_ORACLE` |
| 3 | Daycoval | Conta-corrente | `DAYCOVAL_CC_EXTRATO_DETALHADO` | 3 | Texto | `PARTIAL_ADAPTER` |
| 3 | Guanabara | Conta-corrente | `GUANABARA_CC` | 1 | Texto | `PARTIAL_ADAPTER` |
| 3 | Guanabara | Conta vinculada | `GUANABARA_CONTA_VINCULADA` | 1 | Texto | `PARTIAL_ADAPTER` |
| 4 | Paulista | Conta-corrente | `PAULISTA_CC_DEMONSTRATIVO` | 1 | Texto | `UNSUPPORTED` |
| 4 | Paulista | Conta vinculada | `PAULISTA_CONTA_VINCULADA` | 1 | Texto | `UNSUPPORTED` |
| 4 | Pine | Conta-corrente | `PINE_CC` | 1 | Texto | `UNSUPPORTED` |
| 4 | Pine | Conta vinculada | `PINE_CONTA_VINCULADA` | 2 | Texto | `UNSUPPORTED` |
| 4 | Vórtx | Conta-corrente | `VORTX_CC` | 1 | Texto | `UNSUPPORTED` |
| 4 | Vórtx | Carteira de debêntures | `VORTX_DEBENTURE_PORTFOLIO` | 1 | Texto | `INFORMATIONAL_ONLY` |
| 5 | Safra | Conta-corrente | `SAFRA_CC_MOVIMENTACAO` | 1 | Texto | `CLASSIFICATION_BLOCKED` |
| 5 | Safra | Fundo | `SAFRA_FUNDO_POSICAO` | 1 | Texto | `UNSUPPORTED` |
| 5 | Safra | COE | `SAFRA_COE_POSICAO` | 1 | Texto | `UNSUPPORTED` |
| 5 | Safra | Produto automático | `SAFRA_PRODUTOS_AUTOMATICOS` | 1 | Texto | `UNSUPPORTED` |
| 5 | Safra | Nota de negociação | `SAFRA_NOTA_NEGOCIACAO` | 13 | OCR | `UNSUPPORTED` |
| 6 | Planner | Documento protegido A | `PLANNER_PROTECTED_A` | 1 | Protegido | `PASSWORD_PROTECTED` |
| 6 | Planner | Documento protegido B | `PLANNER_PROTECTED_B` | 1 | Protegido | `PASSWORD_PROTECTED` |

Totais verificados automaticamente: Lote 1 = 20, Lote 2 = 12, Lote 3 = 10, Lote 4 = 7,
Lote 5 = 17 e Lote 6 = 2.

## Regra de homologação

Uma combinação instituição × tipo × família só muda para `HOMOLOGATED` quando possuir contrato,
fixture sintética, teste de colisão, controle de integridade aplicável, execução no arquivo privado,
oráculo revisado por pessoa autorizada e aprovação contábil. A saída corrente do parser não pode ser
usada como oráculo.
