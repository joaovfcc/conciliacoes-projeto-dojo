# Estratégia de testes

## Pirâmide e escopo

- Unitários: dinheiro, data, hash, nomes, configuração e todas as regras do motor.
- Componentes/arquivos: CSV, XLSX e OFX reais e pequenos em diretórios temporários.
- Integração: configuração + adaptadores + Excel + arquivamento.
- End-to-end: CLI em estrutura mensal fictícia, incluindo reprocessamento.
- Regressão/segurança: unicidade, formula injection, path containment e hashes.

Testes não usam internet, relógio implícito, dados pessoais nem mocks do comportamento central.
Fixtures são geradas em memória ou em `tmp_path` para permanecerem pequenas e legíveis.

## Critérios de qualidade

- `pytest`: todos verdes, cobertura de branches e mínimo global de 85%.
- `ruff check .`: sem violações.
- `ruff format --check .`: formatação estável.
- `python -m build`: wheel e sdist válidos.
- execução manual representativa: relatório abre com OpenPyXL e totais conferem.

Testes de desempenho usam um lote sintético e limite generoso após o MVP. Testes de aceite com
arquivos reais e aprovação contábil permanecem atividade do piloto, pois as amostras e a
decisão humana não estão disponíveis no workspace.

