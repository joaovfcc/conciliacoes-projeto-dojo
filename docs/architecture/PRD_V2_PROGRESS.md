# Evolução do motor V2 — rastreabilidade do PRD

Fonte de requisitos: `PRD_EVOLUCAO_MOTOR_CONCILIACAO_BANCARIA.md`, versão 2.0.

## Implementado

| Requisito | Implementação | Evidência automatizada | Situação |
|---|---|---|---|
| Invariantes de matching | Matching particionado por mapeamento confirmado, `Decimal`, seleção máxima global forçada, ordenação estável e testes de propriedade | `reconciliation.test.ts` | Parcial: 1:N/N:1 ainda fora do escopo |
| Épico 0 — conta incompatível | Validação do mapeamento conta contábil × banco/agência/conta no runtime; bloqueio `BANK_ACCOUNT_MISMATCH` | `account-mapping.test.ts`, `account-mapping-gate.test.ts` | Implementado |
| Valor isolado | `VALUE_ONLY_SUGGESTION`; nunca entra nas contagens automáticas | `reconciliation.test.ts` | Implementado |
| Regras de matching V2 iniciais | Exata, tolerância de data, documento ausente, divergência de valor/data, sugestão e ambiguidade | `reconciliation.test.ts` | Parcial |
| Extrato sem movimentos | `STATEMENT_MOVEMENTS_NOT_EXTRACTED` bloqueia sem mensagem explícita; aviso somente quando há declaração de ausência | `pdf-statements.test.ts` | Implementado |
| Safra/Itaú | Detector não usa mais `APLIC AUT` como evidência suficiente para Itaú | `pdf-statements.test.ts` | Implementado |
| Registry de adapters | Seleção por score, limiar e margem; contrato declarativo de família, assinaturas e estratégia de saldo; colisão Safra/Itaú bloqueada | `document-registry.test.ts`, `pdf-statements.test.ts` | Infraestrutura implementada |
| Interface de confirmação | Seleção obrigatória da conta contábil para cada extrato elegível; execução bloqueada sem mapeamento | `confirmed-mappings.test.ts` | Implementado |
| XLSX auditável | Treze abas exigidas, valores monetários numéricos e lista expandida de candidatos ambíguos | `reporting.test.ts` | Implementado |
| Gates de testes vazios | Removido `passWithNoTests`; novas suítes de segurança e fluxo de sessão | `account-mapping-gate.test.ts`, `reconciliation-session.test.ts` | Implementado |
| Inventário privado do corpus | Runner com ZIP privado, hashes, classificação, família e diagnóstico; não persiste nomes, contas, valores ou texto | `private-corpus.test.ts`, `pnpm inventory:private-corpus` | Implementado |
| Matriz de suporte | As 18 instituições e os 68 PDFs estão registrados por estado de parser, sem declarar suporte além da evidência | `PRD_V2_SUPPORT_MATRIX.md` | Implementado |
| PDF protegido | `PasswordException` do PDF.js vira `PDF_PASSWORD_PROTECTED`; Planner não é mais tratado como arquivo inválido | `pdf-statements.test.ts`, inventário privado | Implementado |
| Controle de saldo por linha | Saldos acumulados extraídos produzem totais, saldo inicial inferido, saldo final, diferença e bloqueio em caso de falha | `balance.test.ts`, `pdf-statements.test.ts`, `account-mapping-gate.test.ts` | Parcial: BRB e demais layouts que já expõem saldo |
| Legado Python reproduzível | `pnpm test:legacy` cria `legacy/python/.venv` e executa a suíte sem instalar dependências globais | 83 testes, 87,87% de cobertura | Implementado |
| Paridade privada | Manifesto por SHA-256, com aprovação obrigatória; job de release falha sem corpus | `private-oracle.test.ts`, `test:parity:release` | Infraestrutura implementada; aguardando oráculo humano |
| Medição de cobertura TypeScript | `pnpm test:coverage` mede cada workspace sem exclusões de domínio | Core 86,39%; runtime 31,48%; worker 77,77%; web 16,10% (statements) | Implementado; metas do PRD ainda não atendidas |

## Limitações declaradas

- Os adapters de conta corrente homologados continuam limitados a Bradesco, BRB, Itaú, Santander e Sofisa. Os bancos adicionais do corpus não possuem adapter homologado e devem resultar em rejeição explícita, não em dados parciais.
- O registry já decide de forma pontuada qual layout pode seguir ao parser, mas os parsers legados ainda estão concentrados em `packages/core/src/files.ts`; a extração completa para adapters independentes é o próximo refactor estrutural.
- Controle de saldo por linha e por documento, bem como oráculos revisados manualmente para os 68 PDFs privados, ainda não estão completos. Portanto, nenhum adapter recebeu status `HOMOLOGATED` no sentido integral da seção 28 do PRD.
- Agrupamentos 1:N e N:1 permanecem fora do escopo ativo, como definido para a primeira entrega V2.
- A suíte de paridade continua condicionada ao corpus privado e a um manifesto humano aprovado. Ela não usa a saída atual do parser como oracle.
- O legado Python é mantido apenas como referência e foi validado em ambiente virtual isolado nesta estação. Ele não é a implementação produtiva.
- O inventário separa pista de instituição (somente para agrupar o corpus privado) da identidade bancária detectada. Assim, nenhum dos 11 documentos extraídos foi indevidamente promovido a `HOMOLOGATED`: todos aguardam oráculo humano e controle de saldo.

## Próxima sequência segura

1. Concluir os controles de saldo dos adapters atuais e separar cada parser de `files.ts` em adapter versionado.
2. Criar fixtures sintéticas e oráculos privados revisados para cada família do corpus antes de declarar suporte.
3. Implementar os adapters adicionais somente após obter uma amostra representativa e critérios contábeis homologados.
4. Completar os limites explícitos de 1:N/N:1 e os testes de falsos positivos/duplicidades do matching.
5. Elevar cobertura por área crítica e configurar/executar mutation testing sem excluir regras financeiras.
