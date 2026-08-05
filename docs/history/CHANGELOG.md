# Changelog

Todas as mudanças relevantes deste projeto serão documentadas aqui.

## [Não lançado]

### Adicionado

- Aplicação pública Next.js/React em TypeScript strict, sem autenticação e com conferência em tela.
- Sessões anônimas isoladas por token de 256 bits, heartbeat, TTL e limpeza idempotente.
- Runtime portável com Redis/BullMQ, storage local ou S3 compatível e worker separado.
- Upload defensivo com assinatura real, antivírus, rejeição de macro/ZIP bomb e limite de PDF.
- Dashboard por categoria, evidência lateral e XLSX de oito abas gerado em memória.
- Containers de referência para web/worker e topologia local com Redis e MinIO.

### Alterado

- Razões Protheus paginados agora aceitam conta contábil em linha de metadados e cabeçalhos repetidos.
- OCR configurável por DPI, com padrão de 250 DPI para preservar linhas densas de extratos.
- O perfil Itaú Empresas preserva movimentos idênticos legítimos e ignora linhas de saldo resumido.

## [1.1.0] — 2026-07-31

### Adicionado

- Extratos PDF pesquisáveis com extração por página usando pypdf.
- Detecção de PDFs digitalizados e adaptador OCR Poppler/Tesseract configurável.
- Parser Itaú sintético, fallback tabular conservador e rejeição de layouts desconhecidos.
- Perfil OCR Itaú Empresas e leitura do razão analítico Protheus com múltiplas abas.
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
