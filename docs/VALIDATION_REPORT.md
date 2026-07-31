# Relatório de validação técnica

Data: 31/07/2026. Ambiente: Windows 11, Python 3.12.13.

## Resultados observados

| Validação | Comando | Resultado |
|---|---|---|
| Testes + cobertura | `.venv\Scripts\python.exe -m pytest` | 44 aprovados; 89,82% |
| Lint | `.venv\Scripts\python.exe -m ruff check .` | aprovado |
| Formatação | `.venv\Scripts\python.exe -m ruff format --check .` | aprovado |
| Wheel/sdist | `.venv\Scripts\python.exe -m build` | ambos gerados |
| Executável | `scripts\build_executable.ps1` | `dist\conciliacao.exe`, ~20 MB |
| Smoke do executável | `dist\conciliacao.exe --help` | aprovado |
| Inicialização pelo exe | `dist\conciliacao.exe init --base-dir runtime\exe_validation` | template XLSX criado |
| Fluxo representativo | teste E2E CSV razão + CSV extrato | relatório/log/manifesto/arquivo aprovados |
| Fluxo manual pelo `.exe` | workspace fictício `DEMO`, período 202607 | 2 conciliados, 1 sem razão, saldo diferença 40 |
| XLSX/OFX | testes de integração com arquivos reais pequenos | aprovados |
| Integridade | bytes antes/depois do arquivamento | idênticos |
| Reprocessamento | recusa padrão + autorização explícita | aprovado; output preservado |
| Segurança do Excel | histórico iniciado por fórmula | gravado como texto neutralizado |

O primeiro build do `.exe` foi impedido pela política de execução de scripts do PowerShell. A
causa foi confirmada e o build foi repetido com `-ExecutionPolicy Bypass` restrito ao processo,
concluindo com sucesso.

## Validações externas pendentes

Instalação em máquina corporativa-alvo, assinatura/distribuição do executável, amostras reais,
volume mensal, saldos e aprovação contábil pertencem à fase de piloto e não estavam disponíveis.
