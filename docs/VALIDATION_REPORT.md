# Relatório de validação técnica

Data: 31/07/2026. Ambiente: Windows 11, Python 3.12.13.

## Resultados observados

| Validação | Comando | Resultado |
|---|---|---|
| Testes + cobertura | `.venv\Scripts\python.exe -m pytest` | 77 aprovados; 88,17% |
| Lint | `.venv\Scripts\python.exe -m ruff check .` | aprovado |
| Formatação | `.venv\Scripts\python.exe -m ruff format --check .` | aprovado |
| Wheel/sdist | `.venv\Scripts\python.exe -m build` | ambos gerados |
| Executável | `scripts\build_executable.ps1` | `dist\conciliacao.exe`, 24.797.610 bytes |
| Smoke do executável | `dist\conciliacao.exe --help` | aprovado |
| Inicialização pelo exe | `dist\conciliacao.exe init --base-dir runtime\exe_validation` | template XLSX criado |
| Fluxo representativo | teste E2E CSV razão + CSV extrato | relatório/log/manifesto/arquivo aprovados |
| Fluxo manual pelo `.exe` | workspace fictício `DEMO`, período 202607 | 2 conciliados, 1 sem razão, saldo diferença 40 |
| XLSX/OFX | testes de integração com arquivos reais pequenos | aprovados |
| PDFs pesquisáveis | pypdf + parser Itaú/genérico | páginas, valores e saldos aprovados |
| PDFs digitalizados | PDFs image-only + adaptador OCR injetado | detecção, confiança e falha parcial aprovadas |
| PDFs adversos | protegido, corrompido, assinatura, limites e zero páginas | erros controlados aprovados |
| Inspeção visual PDF | renderização Poppler das fixtures | texto/scanned/multipágina legíveis, sem clipping |
| Fluxo PDF pelo `.exe` | workspace sintético, período 202607 | 2 exatos, 1 sem razão; página/parser no Excel |
| Privacidade de log PDF | busca por conta completa | somente `*****7890` registrado |
| Integridade | bytes antes/depois do arquivamento | idênticos |
| Reprocessamento | recusa padrão + autorização explícita | aprovado; output preservado |
| Segurança do Excel | histórico iniciado por fórmula | gravado como texto neutralizado |

O primeiro build do `.exe` foi impedido pela política de execução de scripts do PowerShell. A
causa foi confirmada e o build foi repetido com `-ExecutionPolicy Bypass` restrito ao processo,
concluindo com sucesso.

## Validações externas pendentes

Instalação em máquina corporativa-alvo, assinatura/distribuição do executável, amostras reais,
volume mensal, saldos e aprovação contábil pertencem à fase de piloto e não estavam disponíveis.
O adaptador OCR está implementado, mas Tesseract não está instalado neste ambiente; por isso o
OCR permanece desabilitado por padrão e a execução do binário real deve ser homologada na máquina
corporativa. Seleção, isolamento, timeout, confiança e recuperação parcial foram validados pelo
contrato injetável sobre PDFs realmente compostos por imagens.
