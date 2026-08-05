# Design — Fontes de extrato PDF e CSV

## Contexto atual

O motor TypeScript já possui modelos de extrato, parsing PDF, parsing tabular genérico, matching, validações de saldo, pré-análise web e um inventário privado baseado em ZIP. A maior dívida é que detecção, extração, parsing e validação ainda convergem em `packages/core/src/files.ts`, e o registry atual representa apenas detecção.

## Arquitetura alvo

```text
arquivo bruto
  → leitor seguro por formato
  → detector de adapter
  → extração (texto/linhas/células)
  → parser da família versionada
  → modelo canônico
  → gates comuns
  → fonte autoritativa
  → matching / relatório / exportação
```

### Contratos

- `StatementSourceAdapter`: `detect`, `parse`, `validate` e metadados estáveis.
- `CanonicalStatement`: identidade, período, balanço, movimentos, classificação, proveniência e diagnóstico.
- `CanonicalTransaction`: data, valor decimal exato, direção, descrição, documento, origem e coordenada de evidência.
- `ValidationIssue`: código estável, severidade, campo/gate e evidência sanitizada.
- `AuthoritativeSourceSelection`: modo, fonte de movimentos e resultado do crosscheck.

### Registro

A chave de registro será `(format, institution, documentType, layoutFamily, version)`. O detector deve falhar fechado em ambiguidade e nunca usar apenas o nome físico do arquivo como decisão final.

### Dinheiro e datas

Valores continuam como strings decimais validadas/`Decimal`, sem `number` JavaScript no domínio. Datas canônicas usam `YYYY-MM-DD`; datas sem ano precisam do período confirmado e não podem atravessar silenciosamente competência ambígua.

### PDF

Extração textual e OCR são camadas separadas. Adapters recebem somente texto/evidência sanitizados. Colunas de saldo nunca geram lançamentos. OCR insuficiente resulta em `REVIEW_REQUIRED` ou erro específico, conforme completude.

### CSV

O leitor lexical não conhece bancos. A família declarativa mapeia aliases de cabeçalho e semântica. A infraestrutura genérica pode ficar `TECHNICALLY_READY_AWAITING_SAMPLE`; um adapter bancário só nasce depois de amostra real e oráculo.

### Compatibilidade

A API pública atual de `parseStatement` permanecerá como façade durante a extração progressiva. Preflight, runtime, relatório e XLSX devem consumir o modelo canônico sem depender do formato original.

## Riscos e mitigação

- Falso positivo: gates bloqueantes, fonte única e testes de duplicidade/saldo.
- Vazamento financeiro: corpus e relatórios privados ignorados; matrizes somente sanitizadas/hash.
- Parser monolítico: extração incremental por família, com teste RED antes de cada movimento.
- Oráculo ausente: estrutura técnica pronta e estado `AWAITING_ORACLE`, sem inventar valores.
- Documento protegido: `BLOCKED_EXTERNAL_CREDENTIAL`, mantendo os outros lotes em execução.
- Infra prematura: ADR obrigatório demonstrando dependência e alternativa simples antes da trilha de produção.

