# Registro de decisões

## D-001 — Registros e OpenPyXL sem Pandas

- Contexto: arquivos mensais e regras um-para-um requerem precisão monetária.
- Problema: simplificar sem perder `Decimal` ou inflar a distribuição.
- Alternativas: Pandas; biblioteca padrão + OpenPyXL.
- Decisão: registros dataclass e OpenPyXL/CSV.
- Justificativa: domínio testável, menor pacote e conversões explícitas.
- Consequências: adaptadores possuem um pouco mais de código, mas sem coerções implícitas.

## D-002 — OFX encapsulado sem dependência externa

- Contexto: o MVP precisa ler OFX e não depende de rede.
- Problema: OFX 1.x frequentemente não é XML estrito.
- Alternativas: pacote `ofxparse`; parser limitado ao contrato bancário necessário.
- Decisão: adaptador tolerante extrai `STMTTRN`, conta e campos obrigatórios.
- Justificativa: instalação previsível e superfície pequena.
- Consequências: variantes reais não cobertas exigirão fixtures e extensão do adaptador.

## D-003 — Manifesto JSON de hashes

- Contexto: não há banco, mas reprocessamento deve ser controlado.
- Problema: arquivos podem voltar com outro nome.
- Alternativas: confiar só na pasta; consultar Excels antigos; manifesto.
- Decisão: manifesto atômico em `02_Processados` com SHA-256.
- Justificativa: simples, rápido e auditável.
- Consequências: o manifesto integra o pacote operacional e deve ser preservado.

## D-004 — Recuperação parcial com geração antes do arquivamento

- Contexto: um extrato inválido não deve ocultar contas válidas, mas erro crítico não pode mover
  entradas.
- Problema: equilibrar continuidade e integridade sem transação de banco.
- Alternativas: abortar no primeiro erro; mover durante leitura; gerar e depois mover.
- Decisão: acumular erros por arquivo/linha, gerar o relatório primeiro e somente então arquivar.
- Justificativa: o output é a confirmação de sucesso e permanece auditável.
- Consequências: uma falha de movimentação é crítica e fica no log; arquivos ainda não movidos
  permanecem na entrada.

## D-005 — Distribuição dupla no Windows

- Contexto: usuários contábeis não devem depender de conhecimento de Python.
- Problema: manter desenvolvimento simples e oferecer execução direta.
- Alternativas: apenas fonte; instalador; executável único + BAT.
- Decisão: manter pacote Python para desenvolvimento e PyInstaller one-file para operação.
- Justificativa: testes/build reproduzíveis e experiência de duplo clique/terminal.
- Consequências: o executável é artefato gerado, deve ser distribuído por canal corporativo e
  pode exigir assinatura conforme a política local.
