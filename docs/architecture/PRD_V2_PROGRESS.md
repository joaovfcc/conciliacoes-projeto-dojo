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
| Colisões BMG/Safra/Sofisa | Posição genérica não identifica Sofisa; a detecção exige marca Sofisa ou o título específico do seu layout | `investments.test.ts`, inventário privado 68/68 | Implementado; aguardando oráculos privados |
| BMG posição de investimento | Adapter `BMG_POSICAO_RENDIMENTO` extrai posição líquida como evidência informativa e nunca cria transações conciliáveis | `bmg-position.test.ts`, inventário privado 68/68 | Implementado; aguardando oráculo privado |
| BMG conta-corrente | Adapter `BMG_CC_WEB` separa crédito, débito e controles de saldo; aceita fechamento estrutural sem movimentos e bloqueia controles divergentes | `bmg-cc.test.ts`, inventário privado 68/68 | Parcial: quatro PDFs processados; aguardando oráculos e controle de saldo por movimento |
| ABC Brasil | Adapters distintos para movimentação e conta vinculada; saldo anterior/final é controle e conta vazia exige declaração explícita | `abc.test.ts`, inventário privado 68/68 | Parcial: quatro PDFs processados em duas famílias; aguardando oráculos privados |
| Banco do Brasil | Conta-corrente usa marcadores C/D e equação de saldo; BB Rende Fácil permanece exclusivamente informativo | `bb.test.ts`, inventário privado 68/68 | Parcial: dois PDFs processados; aguardando oráculos privados |
| BMP | Adapter fechado para a camada textual duplicada; direção limitada aos históricos conhecidos e saldo acumulado validado por linha | `bmp.test.ts`, inventário privado 68/68 | Parcial: um PDF processado; aguardando oráculo privado |
| Bocom BBM | Adapters independentes para o extrato analítico e o documento vazio por OCR; o analítico valida saldo anterior, fechamentos diários e saldo final, e o vazio nunca inventa período ausente | `bocom.test.ts`, inventário privado 68/68 | Parcial: analítico com 8 movimentos processado e aguardando oráculo; vazio aguarda OCR `por` e confirmação de período |
| Caixa | Conta-corrente usa marcadores C/D e valida o saldo acumulado de cada linha e cada `SALDO DIA`; fundo compara resumo e detalhe, emitindo somente resgate, rendimento e posição informativos | `caixa.test.ts`, inventário privado 68/68 | Parcial: duas CC com 17 e 3 movimentos e um fundo com 3 evidências processados; aguardando oráculos privados |
| Daycoval | Ordem cronológica inversa é normalizada sem atribuir saldo extraído a cada linha; cada grupo visual é reconciliado contra seu saldo diário e o saldo atual, incluindo conta vazia estruturalmente completa | `daycoval.test.ts`, `balance.test.ts`, inventário privado 68/68 | Parcial: 13, 0 e 29 movimentos processados sem erro de integridade; aguardando oráculos privados |
| Guanabara | Adapters separados para conta-corrente e conta vinculada; ausência explícita de movimentos exige identidade, período e saldo final completos | `guanabara.test.ts`, `lot-3-gate.test.ts`, inventário privado 68/68 | Parcial: dois PDFs com zero movimentos processados; aguardando oráculos privados |
| Higiene do build do core | `dist` é validado e limpo antes do TypeScript; o runner privado importa a API pública atual, impedindo execução de módulos removidos | `clean-dist.mjs`, inventário privado 68/68 | Implementado |
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
| Estratégia PDF-first/CSV alternativo | Especificação executável, decisões, tarefas e releases separados | `.specs/features/pdf-first-csv-alternative/` | Implementado |
| Inventário por pasta ou ZIP | Enumeração recursiva, SHA-256, trava de quantidade e relatório sanitizado v2 | 68 PDFs, 68 hashes únicos, `private-corpus.test.ts` | Implementado |
| Matriz integral por família | Catálogo tipado de 36 famílias, 18 instituições e 68 PDFs | `corpus-support-matrix.test.ts`, `PRD_V2_SUPPORT_MATRIX.md` | Implementado |
| Disponibilidade de formatos | PDF presente; OFX/CSV/XLSX bancário explicitamente `NOT_PROVIDED` | `PRD_V2_FORMAT_AVAILABILITY_MATRIX.md` | Parcial: referências anônimas de conta aguardam manifesto privado |

## Limitações declaradas

- Nenhuma família está contabilmente homologada sem oráculo humano. Há cobertura técnica parcial para o Lote 1, todo o Lote 2 e todas as famílias do Lote 3; Bocom vazio ainda depende da execução OCR. As demais famílias continuam sendo rejeitadas explicitamente.
- O registry seleciona adapters versionados e independentes por score, limiar e margem. A expansão continua família a família no ciclo RED → GREEN → inventário privado, sem parser genérico para layouts desconhecidos.
- Controle de saldo por linha e por documento, bem como oráculos revisados manualmente para os 68 PDFs privados, ainda não estão completos. Portanto, nenhum adapter recebeu status `HOMOLOGATED` no sentido integral da seção 28 do PRD.
- Agrupamentos 1:N e N:1 permanecem fora do escopo ativo, como definido para a primeira entrega V2.
- A suíte de paridade continua condicionada ao corpus privado e a um manifesto humano aprovado. Ela não usa a saída atual do parser como oracle.
- O legado Python é mantido apenas como referência e foi validado em ambiente virtual isolado nesta estação. Ele não é a implementação produtiva.
- O inventário separa pista de instituição (somente para agrupar o corpus privado) da identidade bancária detectada. Assim, nenhum dos 32 documentos extraídos foi indevidamente promovido a `HOMOLOGATED`: todos aguardam oráculo humano e os controles aplicáveis.
- A dimensão instituição × conta da matriz de formatos aguarda um manifesto privado hash → referência opaca. A estrutura e os status de formato estão prontos; números reais de conta não serão inferidos nem versionados.
- Não foi fornecido extrato OFX, CSV ou XLSX bancário no corpus atual. Todos permanecem `NOT_PROVIDED`; isso não bloqueia adapters PDF nem a infraestrutura CSV sintética.

## Próxima sequência segura

1. Executar os gates integrais do Lote 3 e avançar para Paulista no Lote 4.
2. Executar o OCR Bocom BBM em ambiente com Tesseract `por`; manter período ausente como revisão obrigatória.
3. Obter e revisar os oráculos privados das 24 extrações atuais antes de declarar qualquer família homologada.
4. Prosseguir por Daycoval e Guanabara, sempre com fixture sintética, teste de colisão e inventário privado.
5. Elevar cobertura e mutation testing dos adapters antes das sugestões 1:N/N:1.
