# Matriz de suporte do PRD V2

Esta matriz é derivada do inventário privado executado em 2026-08-03. O artefato privado contém
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
- 11 PDFs foram extraídos, mas permanecem `PARSED_AWAITING_ORACLE`.
- 5 PDFs foram reconhecidos, porém falharam no gate de movimentos.
- 18 PDFs exigem OCR em português.
- 32 layouts textuais estão explicitamente sem adapter.
- 2 PDFs protegidos por senha são bloqueados com diagnóstico explícito.

“Pista de inventário” é derivada apenas do nome privado para agrupar a cobertura. Ela não é usada
pela detecção, pelo parser ou pela conciliação. “Detectado” é a identidade retornada pelo parser.

| Instituição (pista) | PDFs | Estado observado | Detectado pelo parser | Estado de suporte | Próxima unidade verificável |
|---|---:|---|---|---|---|
| ABC Brasil | 4 | 4 layouts não suportados | — | Sem adapter | Classificar famílias e criar adapter por layout |
| Banco do Brasil | 2 | 2 layouts não suportados | — | Sem adapter | Conta corrente e Rende Fácil separadamente |
| BMG | 5 | 5 layouts não suportados | — | Sem adapter | Conta corrente e posição em adapters distintos |
| BMP | 1 | 1 layout não suportado | — | Sem adapter | Criar contrato/fixture do layout |
| Bocom | 2 | 1 OCR pendente, 1 layout não suportado | — | Sem adapter | Validar documento sem movimentos antes de OCR |
| Bradesco | 9 | 8 extraídos, 1 OCR pendente | 6 CC, 2 investimento | Implementado, aguardando oráculo e saldo | Controles de saldo e fixture por família |
| BRB | 1 | 1 reconhecido com gate de movimentos | 1 CC | Implementado, aguardando oráculo e correção | Homologar extração dos movimentos de referência |
| Caixa | 3 | 3 layouts não suportados | — | Sem adapter | Conta corrente e fundo separadamente |
| Daycoval | 3 | 3 layouts não suportados | — | Sem adapter | Criar contrato/fixture do layout |
| Guanabara | 2 | 2 layouts não suportados | — | Sem adapter | Criar contrato/fixture do layout |
| Itaú | 2 | 2 OCR pendentes | — | OCR não homologado | Habilitar OCR `por`, depois separar CC e Aplic Aut Mais |
| Paulista | 2 | 2 layouts não suportados | — | Sem adapter | Criar contrato/fixture do layout |
| Pine | 3 | 3 layouts não suportados | — | Sem adapter | Criar contrato/fixture do layout |
| Planner | 2 | 2 PDFs protegidos por senha | — | Bloqueado explicitamente | Exportar cópia sem proteção; não solicitar senha |
| Safra | 17 | 13 OCR pendentes, 4 layouts não suportados | — | Sem adapter | Primeiro CC; depois fundo, certificado, automático e nota |
| Santander | 2 | 1 extraído, 1 OCR pendente | 1 CC | Implementado, aguardando oráculo e saldo | Separar CC e investimento automático |
| Sofisa | 6 | 6 extraídos | 5 CC, 1 posição | Implementado, aguardando oráculo e saldo | Controle de saldo CC e posição de conferência |
| Vórtx | 2 | 2 layouts não suportados | — | Sem adapter | Conta corrente e carteira de debêntures separadamente |

## Regra de homologação

Uma combinação instituição × tipo × família só muda para `HOMOLOGATED` quando possuir contrato,
fixture sintética, teste de colisão, controle de integridade aplicável, execução no arquivo privado,
oráculo revisado por pessoa autorizada e aprovação contábil. A saída corrente do parser não pode ser
usada como oráculo.
