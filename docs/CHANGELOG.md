# Changelog

Todas as mudanças relevantes deste projeto serão documentadas aqui.

## [Não lançado]

## [1.1.0] — 2026-07-31

### Adicionado

- Extratos PDF pesquisáveis com extração por página usando pypdf.
- Detecção de PDFs digitalizados e adaptador OCR Poppler/Tesseract configurável.
- Parser Itaú sintético, fallback tabular conservador e rejeição de layouts desconhecidos.
- Normalização C/D/CR/DB, descrições multilinha, deduplicação e validação de saldo.
- Proveniência por página/trecho/parser/confiança e métricas de importação no Excel.
- Fixtures PDF sintéticas e testes unitários, integração, E2E e segurança.

### Adicionado

- Fundação Python, análise inicial, arquitetura, estratégia de testes e backlog.
- Leitores de razão CSV/XLSX e extratos CSV/XLSX/OFX com validação parcial.
- Motor conservador com regras 1–9, unicidade, ambiguidade e duplicidade.
- Excel auditável com oito abas, proteção contra fórmulas e campos de revisão.
- CLI/BAT, logs, manifesto SHA-256, arquivamento e reprocessamento versionado.
- Build wheel/sdist, executável Windows e pipeline de qualidade.
- Manual, contratos de layout, matriz de rastreabilidade e relatório de validação.
