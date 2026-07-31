# Manual do usuário

## Primeira utilização

1. Execute `conciliacao init --base-dir C:\Conciliacao`.
2. Abra `05_Configuracao\CONFIGURACAO_CONTAS.xlsx`.
3. Preencha a aba `Contas` conforme `docs/LAYOUTS.md`.
4. Salve e feche o Excel.
5. Garanta permissão de leitura e escrita em toda a raiz.

Não coloque senhas, tokens, números de cartão ou credenciais na configuração.

## Fechamento mensal

1. Exporte o razão com o período e as contas corretos.
2. Salve-o em `01_Entrada\Razao` com o nome padronizado.
3. Salve cada extrato em `01_Entrada\Extratos` com banco/agência/conta/período no nome.
4. Execute `executar_conciliacao.bat --periodo AAAAMM` ou a CLI.
5. Aguarde a mensagem `Processamento concluído`.
6. Abra `04_Resultados\AAAA-MM\CONCILIACAO_*.xlsx`.

PDF pesquisável funciona sem configuração adicional. Para digitalizados, instale Poppler e
Tesseract e defina `PDF_ENABLE_OCR=SIM`; mantenha `NAO` quando OCR não for homologado. Nunca use
OCR para contornar PDF protegido: solicite uma exportação sem senha ao banco.

## Revisão do relatório

1. Comece por `Resumo` e filtre `COM_DIVERGENCIAS`.
2. Confira `Conciliados`; as regras exata/tolerante não reutilizam registros.
3. Em `Divergencias_Detalhadas`, preencha status, justificativa, ação, responsável e prazo.
4. Revise integralmente `Razao_Sem_Extrato` e `Extrato_Sem_Razao`.
5. Em `Ambiguidades`, escolha manualmente somente após validar todas as evidências.
6. Consulte `Erros_Tecnicos` e o log para arquivos/linhas rejeitados.
7. Para PDF, confira página, trecho original, parser, método e confiança antes de decidir.
8. Preserve relatório, log, manifesto e pastas processadas como pacote de evidências.

## Corrigir e reexecutar

Corrija o arquivo indicado, recoloque-o na entrada e execute novamente. Se o hash já estiver no
manifesto, confirme que a repetição é intencional e use `--reprocessar`. A aplicação nunca
substitui um relatório ou arquivo arquivado anterior; gera nome versionado.

Não edite `processed_hashes.json` manualmente. Um manifesto corrompido interrompe a execução
para evitar perda de idempotência.

## Quando acionar desenvolvimento

- layout real válido não reconhecido;
- `PDF_LAYOUT_NAO_RECONHECIDO`, OCR com confiança baixa ou página ilegível;
- PDF pesquisável que foi classificado incorretamente como digitalizado;
- OFX sem `STMTTRN`, `DTPOSTED` ou `TRNAMT` apesar de abrir no banco;
- conta corretamente configurada ainda não relacionada;
- totais do detalhe diferentes do resumo;
- falha crítica de escrita/permissão;
- necessidade de nova regra ou agrupamento.

Envie apenas fixtures anonimizadas, o código/mensagem do erro e o log; não envie dados
bancários completos por canais não aprovados.

Ao solicitar um novo parser, envie uma fixture estruturalmente equivalente e anonimizada, indique
banco/layout/período esperado e exemplos de débito/crédito. Desenvolvimento deverá registrar o
parser antes do genérico e incluir testes unitários, integração e evidência por página.
