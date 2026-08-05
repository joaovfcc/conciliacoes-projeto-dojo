# Conciliação Bancária

Aplicação web pública para conciliar um razão Protheus com até cinco extratos bancários. A
implementação oficial é o monorepo TypeScript; a primeira implementação Python está preservada
em `legacy/python` somente para auditoria e testes de paridade.

## Arquitetura

```text
Navegador -> Next.js/API -> runtime -> core
                         -> BullMQ -> worker -> runtime -> core
```

- `apps/web`: interface React e rotas HTTP Next.js;
- `apps/worker`: consumo assíncrono da fila e limpeza de sessões;
- `packages/core`: parsers, normalização, regras de conciliação e exportação XLSX;
- `packages/runtime`: sessões anônimas, storage, segurança, OCR e filas;
- `infra`: Dockerfiles e ambiente local Redis/MinIO;
- `legacy/python`: implementação local anterior, fora do caminho produtivo.

O MVP não usa banco relacional. Sessões e resultados são temporários; uploads são removidos após
o processamento ou encerramento.

## Desenvolvimento

Requisitos da aplicação principal: Node.js 24 e pnpm 11.9.

```powershell
pnpm install
pnpm dev
```

A aplicação fica disponível em `http://localhost:3000` e, sem Redis/S3 configurados, usa sessão
em memória e armazenamento local temporário.

### PDFs e OCR local

Os layouts atualmente reconhecidos incluem conta corrente de Bradesco, BRB, Itaú, Santander e Sofisa.
Documentos de investimento de Bradesco, Itaú e Santander são exibidos apenas para conferência;
posição de renda fixa Sofisa também é informativa. Eles não participam da conciliação um a um.

PDFs digitalizados exigem Poppler e Tesseract com o idioma português (`por`) instalado. Em Docker
isso já vem configurado. No Windows, configure `PDF_OCR_COMMAND`, `PDF_RENDER_COMMAND` e, se
necessário, `TESSDATA_PREFIX` para um diretório externo que contenha `por.traineddata`; nunca use
`tmp/tessdata` dentro do repositório. Sem OCR disponível, a aplicação responde com o diagnóstico
específico `PDF_OCR_UNAVAILABLE`.

## Testes

```powershell
pnpm test:unit
pnpm test:components
pnpm test:integration
pnpm test:e2e
pnpm test:security
pnpm test:parity
pnpm test:legacy
pnpm test
```

Testes unitários e de componentes ficam no workspace responsável. Testes que atravessam dois ou
mais módulos ficam em `tests/`. Baselines financeiros privados são informados por
`PARITY_FIXTURES_DIR` e nunca são versionados. A execução de release deve fornecer também o
manifesto privado revisado manualmente; a ausência do corpus não representa homologação.

O comando `pnpm test` inclui o legado. Para executá-lo, ative antes um ambiente Python 3.12 com
as dependências de desenvolvimento:

```powershell
python -m venv legacy/python/.venv
& legacy/python/.venv/Scripts/Activate.ps1
python -m pip install -e "legacy/python[dev]"
pnpm test
```

## Qualidade e build

```powershell
pnpm lint
pnpm typecheck
pnpm build
```

## Ambiente portável

```powershell
docker compose -f infra/compose.yaml up --build
```

Esse ambiente inicia web, worker, Redis e MinIO. O worker contém Poppler, Tesseract em português
e ClamAV.

## Documentação

- [PRD da aplicação web](docs/product/PRD_APLICACAO_WEB.md)
- [Arquitetura atual](docs/architecture/ARCHITECTURE.md)
- [Estratégia de testes](docs/architecture/TEST_STRATEGY.md)
- [Layouts de arquivos](docs/architecture/FILE_LAYOUTS.md)
- [Rastreabilidade do PRD V2](docs/architecture/PRD_V2_PROGRESS.md)
- [Manual do usuário](docs/operations/MANUAL_USUARIO.md)
- [Documentação histórica](docs/history/)

## Escopo da conciliação

Cada extrato de conta corrente deve ser relacionado explicitamente a uma conta contábil durante a
pré-análise. Banco, agência e conta extraídos precisam coincidir com os metadados da conta no
razão; qualquer divergência bloqueia a execução com `BANK_ACCOUNT_MISMATCH`.

O motor só concilia automaticamente um par único dentro desse mapeamento quando há evidência
forte: documento, data e valor exatos; documento e valor com data na tolerância; ou valor e data
com documento ausente em pelo menos uma das fontes. Igualdade isolada de valor sempre aparece como
`VALUE_ONLY_SUGGESTION` para revisão humana.
