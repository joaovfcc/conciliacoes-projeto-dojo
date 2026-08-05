# Implementação Python legada

Esta pasta preserva a primeira implementação local da conciliação bancária. Ela não é usada
pela aplicação web e permanece somente para auditoria, comparação de paridade e consulta das
regras históricas.

## Validação

```powershell
$env:PYTHON_EXECUTABLE = 'C:\Python311\python.exe' # omita se `python` já estiver no PATH
pnpm test:legacy
```

O comando cria `legacy/python/.venv` e instala as dependências exclusivamente nele. Não altera o
Python global da máquina.

Os artefatos gerados pelo executável e as execuções operacionais não devem ser versionados.
