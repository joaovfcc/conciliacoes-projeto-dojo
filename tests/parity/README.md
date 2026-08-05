# Corpus privado de PDF

Defina `PARITY_FIXTURES_DIR` para uma pasta privada que não pertença ao repositório. Essa pasta
deve conter os PDFs homologados e `statement-parser-manifest.json` com uma entrada por hash:

```json
[
  {
    "fileSha256": "sha256-do-pdf",
    "adapterId": "ITAU_EMPRESAS_CC",
    "adapterVersion": "2",
    "classification": "CURRENT_ACCOUNT",
    "bank": "ITAU",
    "agency": "0191",
    "account": "26775-6",
    "periods": ["202512"],
    "recordCount": 1723,
    "balanceCheck": "PASSED",
    "approvalReference": "CONTABIL-2026-01"
  }
]
```

O manifesto e os arquivos financeiros são privados e nunca devem ser versionados. O teste verifica
classificação, metadados, período, quantidade, parser e saldo final quando aplicável, além de
confirmar que saldo não é convertido em lançamento e que investimentos não entram na conciliação.

Use `pnpm test:parity:release` no runner com corpus privado. Esse comando falha se o manifesto não
estiver disponível; `pnpm test:parity` local mantém essa ausência visível sem inventar um oráculo.
