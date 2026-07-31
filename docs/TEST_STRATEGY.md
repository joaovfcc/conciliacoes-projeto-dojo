# Estratégia de testes

## Pirâmide e escopo

- Unitários: dinheiro, data, hash, nomes, configuração e todas as regras do motor.
- Componentes/arquivos: CSV, XLSX, OFX e PDFs estruturalmente reais e pequenos.
- Integração: configuração + adaptadores + Excel + arquivamento.
- End-to-end: CLI em estrutura mensal fictícia, incluindo reprocessamento.
- Regressão/segurança: unicidade, formula injection, path containment e hashes.

Testes não usam internet, relógio implícito, dados pessoais nem mocks do comportamento central.
Fixtures são geradas em memória ou em `tmp_path` para permanecerem pequenas e legíveis. As
fixtures PDF sintéticas ficam em `tests/fixtures/pdf-statements/{text-based,scanned,invalid,
unsupported-layout,multi-page}` e podem ser reproduzidas por `scripts/generate_pdf_fixtures.py`.

## Matriz PDF

- Unitários: assinatura/configuração, valores C/D/CR/DB e sinal posterior, datas com/sem ano,
  detector, agrupamento multilinha/entre páginas, cabeçalhos, deduplicação e saldos.
- Integração: pypdf abre PDFs reais, percorre todas as páginas, seleciona texto/OCR, rejeita
  proteção/corrupção/zero páginas/limites e preserva erros por página.
- OCR: o adaptador é injetado sobre PDFs realmente compostos por imagens; seleção, confiança
  baixa e falha parcial são verificadas sem exigir Tesseract na CI.
- E2E: PDF -> parser -> validação -> conciliação -> Excel, verificando valor, data, descrição,
  arquivo, página e motivo da divergência.
- Visual: fixtures pesquisável, digitalizada e multipágina são renderizadas por Poppler e
  inspecionadas para legibilidade, clipping e composição correta.

## Critérios de qualidade

- `pytest`: todos verdes, cobertura de branches e mínimo global de 85%.
- `ruff check .`: sem violações.
- `ruff format --check .`: formatação estável.
- `python -m build`: wheel e sdist válidos.
- execução manual representativa: relatório abre com OpenPyXL e totais conferem.

Testes de desempenho usam um lote sintético e limite generoso após o MVP. Testes de aceite com
arquivos reais e aprovação contábil permanecem atividade do piloto, pois as amostras e a
decisão humana não estão disponíveis no workspace.
