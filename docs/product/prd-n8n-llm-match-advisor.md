# PRD — Gateway de IA para sugestões de conciliação via n8n

**Versão:** 1.0  
**Status:** proposta para aprovação e implementação  
**Data:** 8 de setembro de 2026  
**Produto:** Conciliação bancária assistida por IA  
**Público-alvo:** Contabilidade, Controladoria, Auditoria, TI e Desenvolvimento

## 1. Resumo executivo

A aplicação continuará usando o motor TypeScript determinístico como autoridade
para leitura, normalização, cálculos, regras contábeis, evidências e totais da
conciliação.

O produto adicionará um componente denominado `LlmMatchAdvisor`. Esse componente
analisará apenas pendências e ambiguidades previamente delimitadas pelo motor. A
implementação produtiva do componente chamará um servidor n8n por HTTP. O n8n
atuará como gateway de IA e poderá encaminhar a solicitação para diferentes
provedores ou modelos sem exigir uma nova versão da aplicação.

A inteligência artificial não poderá criar valores, linhas, arquivos ou
identificadores. Ela poderá apenas selecionar identificadores canônicos enviados
pela aplicação e explicar, em português, por que considera uma relação provável.
A aplicação validará toda resposta antes de apresentá-la.

Na primeira entrega, todas as sugestões da IA exigirão revisão humana e ficarão
fora dos totais conciliados automaticamente. Falha, indisponibilidade ou resposta
inválida do n8n preservará integralmente o resultado determinístico atual.

## 2. Contexto e problema

O motor atual identifica conciliações comprováveis por regras determinísticas e
mantém rastreabilidade até o arquivo e a linha de origem. Entretanto, alguns
lançamentos permanecem sem correspondência ou ambíguos porque:

- o razão e o extrato usam descrições diferentes para o mesmo evento;
- documentos aparecem abreviados, agregados ou ausentes;
- o Protheus agrupa movimentos bancários;
- existem vários lançamentos com o mesmo valor;
- a evidência é suficiente para sugerir uma relação, mas não para confirmá-la por
  uma regra automática conservadora.

Migrar toda a conciliação para uma LLM reduziria repetibilidade e segurança
contábil. Integrar diretamente um único provedor à aplicação, por outro lado,
aumentaria o acoplamento e tornaria mais trabalhosa a troca de fornecedor.

O n8n resolverá a orquestração e o roteamento entre modelos. O core continuará
responsável pela decisão contábil, pela validação e pela evidência.

## 3. Objetivos

### 3.1 Objetivo principal

Reduzir o volume de pendências que exigem investigação manual por meio de
sugestões de IA auditáveis, reversíveis e independentes de um único provedor.

### 3.2 Objetivos específicos

- preservar integralmente o resultado determinístico existente;
- manter arquivo, planilha, linha, página, valor e descrição originais;
- permitir troca de provedor ou modelo no n8n;
- apresentar explicações em português;
- limitar a IA a candidatos produzidos deterministicamente;
- impedir que sugestões não aprovadas afetem os totais conciliados;
- oferecer fallback automático quando o serviço de IA estiver indisponível;
- medir a qualidade por banco, família de layout e tipo de correspondência;
- manter custos, latência e volume de dados enviados sob controle;
- produzir trilha técnica suficiente para auditoria e reprodução.

### 3.3 Indicadores de sucesso

- zero identificadores, valores ou linhas inventados;
- zero alteração nos matches determinísticos de referência;
- zero sugestão de IA contabilizada como match automático no primeiro release;
- 100% das sugestões ligadas a registros canônicos existentes;
- 100% das sugestões exibindo arquivo e linha ou página quando disponíveis;
- disponibilidade da conciliação determinística mesmo com n8n indisponível;
- precisão das sugestões medida contra oráculo humano privado;
- custo e latência medidos por execução e por sugestão útil.

O PRD não define antecipadamente uma meta de precisão contábil. A equipe deverá
estabelecer o gate depois de formar um corpus revisado por profissionais da área.

## 4. Princípios obrigatórios

### 4.1 Deterministic-first

O motor atual executa antes da IA. A IA nunca substitui parsing, normalização,
aritmética monetária, controle de saldo ou regras automáticas homologadas.

### 4.2 Identificadores, não evidência inventada

A IA recebe identificadores opacos e campos normalizados. Ela não recebe a
responsabilidade de informar linha, arquivo, valor ou saldo. A aplicação recupera
esses dados dos registros canônicos depois da resposta.

### 4.3 Uma interface estável

A aplicação conhece apenas a porta `LlmMatchAdvisor`. A implementação inicial da
porta será `N8nMatchAdvisor`. O core não dependerá do SDK de nenhum provedor.

### 4.4 Sugestão não é conciliação

Toda resposta da IA será `REVIEW_REQUIRED` no primeiro release. Somente a ação
explícita de um usuário autorizado poderá aceitar ou rejeitar a sugestão.

### 4.5 Falha segura

Timeout, erro de rede, circuito aberto, resposta fora do schema ou indisponibilidade
do modelo não poderá impedir a conclusão determinística.

### 4.6 Homologação por modelo

A interface será agnóstica de fornecedor. A qualidade contábil não será presumida
como agnóstica. Cada combinação de provedor, modelo, versão do prompt e família de
layout deverá passar pelos gates antes de ficar disponível em produção.

## 5. Escopo

### 5.1 Incluído

- porta `LlmMatchAdvisor` no core;
- gerador determinístico de conjuntos de candidatos;
- adapter HTTP `N8nMatchAdvisor` no runtime;
- workflow principal versionado no n8n;
- sub-workflows por provedor;
- resposta estruturada e versionada;
- validação pós-LLM no core;
- fallback determinístico;
- modo desabilitado, sombra e revisão;
- exibição de sugestões na interface existente;
- exportação das sugestões e evidências no XLSX existente;
- auditoria técnica sem conteúdo financeiro em logs;
- métricas de qualidade, custo e latência;
- testes unitários, de contrato, integração, segurança, paridade e avaliação;
- documentação operacional para adicionar ou trocar modelos.

### 5.2 Fora do escopo inicial

- substituir parsers bancários por IA;
- enviar XLSX, CSV, OFX ou PDF completos ao n8n;
- permitir que a IA confirme conciliações automaticamente;
- permitir que a IA altere lançamentos, saldos ou resultados;
- executar cálculo monetário dentro do prompt;
- usar confiança declarada pelo modelo como aprovação contábil;
- implementar um servidor MCP;
- permitir seleção pública e irrestrita de modelos pelo usuário final;
- treinar ou ajustar um modelo proprietário;
- armazenar documentos financeiros no n8n;
- usar agentes com acesso livre a ferramentas ou à internet.

## 6. Arquitetura funcional

```text
Razão e extratos
       |
       v
Parsing e normalização existentes
       |
       v
Motor determinístico TypeScript
       |
       +------------------------------> matches confirmados
       |
       v
Pendências e ambiguidades
       |
       v
Gerador determinístico de candidatos
       |
       v
N8nMatchAdvisor -- HTTP autenticado --> n8n
                                         |
                                         +--> OpenAI
                                         +--> Azure OpenAI
                                         +--> Anthropic
                                         +--> Gemini
                                         +--> AWS Bedrock
                                         +--> modelo local
                                         |
       +---------- resposta por IDs <----+
       |
       v
Validação determinística e reidratação de evidências
       |
       v
ReconciliationResult atual
       |
       +--> interface
       +--> XLSX
```

### 6.1 Responsabilidades da aplicação

- processar os arquivos;
- produzir registros canônicos;
- executar as regras existentes;
- gerar candidatos limitados;
- assinar e enviar a requisição;
- validar a resposta do n8n;
- recalcular todos os controles monetários;
- recuperar evidências pelos IDs;
- impedir reutilização de registros;
- apresentar e exportar a sugestão;
- manter o resultado determinístico em caso de falha.

### 6.2 Responsabilidades do n8n

- autenticar a chamada da aplicação;
- validar a versão básica do contrato;
- selecionar o provedor configurado;
- aplicar o prompt versionado;
- solicitar uma resposta estruturada;
- normalizar a resposta do provedor;
- devolver o contrato comum;
- aplicar timeout, retry restrito e limite de concorrência;
- registrar somente metadados técnicos permitidos.

### 6.3 Responsabilidades da LLM

- comparar o histórico e o documento de candidatos já delimitados;
- indicar se existe relação provável;
- selecionar somente IDs recebidos;
- explicar a sugestão em português;
- indicar evidência insuficiente quando não houver base segura.

## 7. Requisitos funcionais

### AI-RF-001 — Feature flag e modos de operação

O sistema deverá oferecer os modos:

- `DISABLED`: não chama o n8n;
- `SHADOW`: chama o n8n, registra métricas permitidas e não altera a resposta;
- `REVIEW`: mostra sugestões validadas para revisão humana.

O modo inicial de produção será `DISABLED`. A promoção seguirá os gates deste PRD.

### AI-RF-002 — Execução posterior ao motor atual

O advisor deverá executar somente depois da conclusão do motor determinístico. Ele
não poderá remover, modificar ou substituir um match automático já produzido.

### AI-RF-003 — Elegibilidade

Poderão gerar candidatos:

- `AMBIGUOUS_MATCH`;
- `LEDGER_WITHOUT_STATEMENT`;
- `STATEMENT_WITHOUT_LEDGER`;
- `VALUE_ONLY_SUGGESTION`;
- `GROUP_SUGGESTION`.

Itens bloqueados, investimentos, movimentos excluídos, registros fora da
competência e documentos não conciliáveis não poderão ser enviados.

### AI-RF-004 — Geração de candidatos

O gerador deverá considerar somente registros ainda não consumidos e aplicar,
antes da IA:

- competência confirmada;
- escopo contábil confirmado;
- moeda;
- perfil de sinais;
- compatibilidade de valores ou somatórios;
- limites de cardinalidade configurados;
- filtros de datas e documentos quando aplicáveis;
- limite máximo de candidatos por âncora;
- ordem estável e identificadores determinísticos.

O gerador deverá medir separadamente sua cobertura. A ausência do match correto no
conjunto de candidatos não poderá ser atribuída à LLM.

### AI-RF-005 — Minimização de dados

A requisição poderá conter somente:

- identificador canônico;
- lado `LEDGER` ou `STATEMENT`;
- data normalizada;
- valor em centavos como string;
- documento normalizado;
- histórico normalizado e necessário para comparação;
- identificador lógico do grupo;
- competência e moeda.

A requisição não poderá conter arquivo binário, caminho local, nome original do
arquivo, número da linha, número da página, saldo integral, credencial, CPF, CNPJ
ou outro identificador que não seja necessário para a análise.

### AI-RF-006 — Contrato da porta

O core deverá expor uma interface equivalente a:

```ts
export interface LlmMatchAdvisor {
  advise(
    request: AdvisorRequest,
    signal?: AbortSignal,
  ): Promise<AdvisorResponse>;
}
```

Deverão existir implementações `DisabledMatchAdvisor`, `FakeMatchAdvisor` e
`N8nMatchAdvisor`.

### AI-RF-007 — Chamada ao n8n

O `N8nMatchAdvisor` deverá:

- usar HTTPS em produção;
- aplicar autenticação forte entre serviços;
- incluir `requestId`, `contractVersion` e chave de idempotência;
- aplicar timeout configurável;
- limitar o tamanho do corpo;
- não registrar o corpo financeiro;
- validar status HTTP e tipo de conteúdo;
- rejeitar respostas acima do tamanho permitido;
- usar circuito de proteção para falhas consecutivas.

### AI-RF-008 — Roteamento de provedores

O workflow principal deverá selecionar um sub-workflow homologado por configuração.
Todos os sub-workflows deverão implementar o mesmo contrato de entrada e saída.

A troca de provedor não poderá exigir mudança no core ou no frontend. Ela exigirá
teste de contrato e homologação de qualidade.

### AI-RF-009 — Resposta estruturada

O n8n deverá devolver somente:

- versão do contrato;
- identificador da requisição;
- identificador técnico do provedor e modelo;
- versão do prompt;
- IDs de âncora e candidatos;
- decisão;
- código de motivo;
- confiança em pontos-base;
- explicação em português.

### AI-RF-010 — Validação pós-LLM

A aplicação deverá rejeitar a sugestão quando:

- algum ID não existir;
- algum ID não pertencer ao conjunto enviado;
- o lado do lançamento estiver incorreto;
- houver reutilização de lançamento;
- o registro já estiver conciliado;
- competência, conta lógica ou moeda forem incompatíveis;
- sinais ou valores não fecharem deterministicamente;
- a cardinalidade exceder o limite;
- o contrato ou a versão forem desconhecidos;
- a decisão estiver fora do vocabulário permitido;
- a explicação contiver dados não presentes na entrada.

Uma resposta parcialmente inválida será rejeitada por grupo. Ela não poderá ser
corrigida automaticamente por outra LLM.

### AI-RF-011 — Reidratação de evidências

Depois da validação, a aplicação deverá recuperar `LedgerRecord` e
`StatementRecord`
pelos IDs. Arquivo, linha, página, valor, data e descrição deverão vir somente do
`SourceEvidence` canônico.

### AI-RF-012 — Projeção no resultado atual

Uma sugestão individual deverá usar `VALUE_ONLY_SUGGESTION`. Uma sugestão 1:N ou
N:1 deverá usar `GROUP_SUGGESTION`. Ambas deverão usar:

- `decisionLevel: REVIEW_REQUIRED`;
- regra versionada específica do advisor;
- motivo em português;
- registros canônicos completos;
- evidências originais;
- totais recalculados pela aplicação.

A equipe poderá introduzir um status específico para IA apenas em uma futura
versão do contrato de resultados.

### AI-RF-013 — Interface

A interface deverá:

- identificar claramente a origem da sugestão como “Sugestão da IA”;
- mostrar que a sugestão exige revisão;
- exibir provedor/modelo somente na evidência técnica, quando autorizado;
- apresentar razão e extrato lado a lado;
- manter arquivo, linha ou página, data, valor, documento e histórico;
- permitir aceitar ou rejeitar a sugestão;
- impedir aprovação em lote no primeiro release;
- manter todos os textos voltados ao usuário em português.

### AI-RF-014 — XLSX

O XLSX deverá usar a mesma fonte de dados da interface e preservar:

- IDs;
- status;
- nível de decisão;
- regra;
- motivo;
- linhas do razão e do extrato;
- arquivo e linha ou página;
- totais e diferenças recalculados;
- versão da regra e do advisor.

Sugestões não aprovadas deverão permanecer na planilha de sugestões e não poderão
compor as abas ou indicadores de conciliações confirmadas.

### AI-RF-015 — Aprovação e rejeição

A decisão humana deverá registrar:

- usuário;
- data e hora;
- sugestão original;
- decisão de aceitar ou rejeitar;
- versão do modelo, prompt e contrato;
- IDs envolvidos;
- justificativa opcional do usuário.

A aprovação deverá executar novamente as validações determinísticas antes de
alterar o estado do resultado.

### AI-RF-016 — Fallback

Em qualquer falha do advisor, a aplicação deverá:

- preservar o resultado determinístico;
- concluir a execução;
- apresentar aviso não técnico quando necessário;
- registrar código técnico sem dados financeiros;
- não repetir indefinidamente a chamada;
- permitir nova tentativa controlada apenas sobre as sugestões.

### AI-RF-017 — Auditoria técnica

A auditoria deverá registrar:

- `requestId` e hash estável da entrada minimizada;
- versão do contrato;
- provedor e modelo;
- versão do prompt;
- modo de operação;
- quantidade de grupos e candidatos;
- duração;
- contagem de tokens, quando fornecida;
- resultado técnico da chamada;
- quantidade de sugestões aceitas e rejeitadas pela validação;
- códigos de rejeição.

Logs e métricas não poderão registrar históricos, documentos, valores, contas ou
conteúdo de prompts.

### AI-RF-018 — Homologação de modelos

O sistema deverá manter uma matriz privada com:

```text
provedor × modelo × prompt × banco × família de layout × status
```

Os status serão `NOT_TESTED`, `SHADOW`, `REVIEW_APPROVED`, `BLOCKED` e
`RETIRED`. Um modelo não homologado poderá operar apenas em `SHADOW`.

### AI-RF-019 — Versionamento de workflows

Os workflows e sub-workflows do n8n deverão ser exportados e versionados no
repositório. Mudanças de prompt, contrato, roteamento ou parser de saída deverão
passar por revisão e testes antes da publicação.

### AI-RF-020 — Desativação imediata

A equipe deverá conseguir desabilitar globalmente o advisor sem republicar o
frontend e sem interromper a conciliação determinística.

## 8. Contratos

### 8.1 Requisição da aplicação para o n8n

```ts
type AdvisorRequestV1 = {
  contractVersion: "1.0";
  requestId: string;
  idempotencyKey: string;
  period: string;
  currency: "BRL";
  promptVersion: string;
  groups: Array<{
    groupId: string;
    anchorId: string;
    entries: Array<{
      id: string;
      source: "LEDGER" | "STATEMENT";
      date: string;
      amountCents: string;
      document: string;
      normalizedHistory: string;
    }>;
  }>;
};
```

### 8.2 Resposta do n8n para a aplicação

```ts
type AdvisorResponseV1 = {
  contractVersion: "1.0";
  requestId: string;
  provider: string;
  model: string;
  promptVersion: string;
  suggestions: Array<{
    groupId: string;
    anchorId: string;
    candidateIds: string[];
    decision: "SUGGEST_MATCH" | "NO_MATCH" | "REVIEW_REQUIRED";
    confidenceBps: number;
    reasonCode:
      | "HISTORY_SIMILARITY"
      | "DOCUMENT_REFERENCE"
      | "PROBABLE_GROUP"
      | "INSUFFICIENT_EVIDENCE";
    explanationPtBr: string;
  }>;
};
```

### 8.3 Códigos de erro

- `ADVISOR_DISABLED`;
- `ADVISOR_TIMEOUT`;
- `ADVISOR_UNAVAILABLE`;
- `ADVISOR_CONTRACT_MISMATCH`;
- `ADVISOR_INVALID_RESPONSE`;
- `ADVISOR_UNKNOWN_ID`;
- `ADVISOR_SCOPE_VIOLATION`;
- `ADVISOR_REUSED_TRANSACTION`;
- `ADVISOR_AMOUNT_MISMATCH`;
- `ADVISOR_CARDINALITY_EXCEEDED`;
- `ADVISOR_CIRCUIT_OPEN`.

Esses erros não deverão transformar uma conciliação determinística válida em
falha de processamento.

## 9. Desenho dos workflows n8n

### 9.1 Workflow principal `AI_MATCH_ADVISOR_V1`

1. Receber a chamada em webhook interno.
2. Validar autenticação, tamanho e versão.
3. Verificar idempotência.
4. Remover campos não permitidos.
5. Obter o provedor ativo.
6. Executar o sub-workflow homologado.
7. Aplicar o parser estruturado.
8. Validar o formato básico da resposta.
9. Remover conteúdo adicional do provedor.
10. Responder com o contrato comum.

### 9.2 Sub-workflows

Cada sub-workflow deverá:

- receber o mesmo `AdvisorRequestV1`;
- usar credencial isolada;
- aplicar o mesmo prompt funcional;
- solicitar JSON estruturado quando o provedor oferecer suporte;
- rejeitar texto livre fora do contrato;
- devolver `AdvisorResponseV1`;
- ter timeout e limite de tentativas;
- não persistir o corpo além do período operacional permitido.

### 9.3 Troca de modelo

A troca deverá seguir esta sequência:

1. Cadastrar a credencial do provedor.
2. Criar ou atualizar o sub-workflow.
3. Executar os testes de contrato.
4. Executar o modo sombra no corpus privado.
5. Atualizar a matriz de homologação.
6. Aprovar o modelo para `REVIEW`.
7. Alterar a configuração do workflow principal.

Trocar o nome do modelo sem repetir os gates será proibido.

## 10. Segurança e privacidade

### 10.1 Implantação

O n8n deverá operar em ambiente privado ou com endpoint restrito aos serviços da
aplicação. O webhook não deverá ficar acessível anonimamente pela internet.

### 10.2 Autenticação entre serviços

A primeira versão deverá usar assinatura HMAC com timestamp e proteção contra
replay. Em ambientes que ofereçam suporte, a equipe poderá adicionar mTLS.

### 10.3 Dados financeiros

- Não enviar arquivos completos.
- Não enviar nomes originais de arquivos.
- Não enviar linhas ou páginas.
- Não registrar corpo de requisição ou resposta.
- Não habilitar memória conversacional.
- Não usar ferramentas externas ou pesquisa na internet.
- Não reutilizar dados de uma empresa em outra requisição.
- Configurar retenção e expurgo de execuções do n8n.
- Revisar os controles de retenção de cada provedor.

### 10.4 Credenciais

Credenciais deverão permanecer no cofre de credenciais do n8n ou em gerenciador de
segredos compatível. Elas não poderão aparecer em workflows exportados, logs ou
variáveis do frontend.

### 10.5 Revisão de segurança

Antes de produção, a equipe deverá executar o recurso de auditoria de segurança do
n8n, revisar webhooks, nós com execução de código, nós comunitários, permissões,
rede de saída e política de atualização.

## 11. Requisitos não funcionais

### AI-RNF-001 — Disponibilidade

A indisponibilidade do n8n não poderá indisponibilizar o motor determinístico.

### AI-RNF-002 — Latência

O advisor deverá possuir timeout configurável e orçamento de latência separado do
processamento determinístico. A interface deverá indicar quando as sugestões ainda
estiverem em processamento.

### AI-RNF-003 — Idempotência

A mesma requisição lógica deverá produzir no máximo um registro de auditoria e uma
resposta ativa por versão de modelo e prompt.

### AI-RNF-004 — Escalabilidade

O n8n deverá limitar concorrência, tamanho dos lotes e quantidade de candidatos.
A aplicação poderá dividir uma execução em lotes independentes e idempotentes.

### AI-RNF-005 — Portabilidade

O adapter HTTP não deverá depender de recursos proprietários do n8n. A equipe
poderá substituir o gateway no futuro mantendo a interface `LlmMatchAdvisor`.

### AI-RNF-006 — Custo

O sistema deverá registrar metadados de consumo por execução e aplicar limites de
grupos, candidatos, tokens e tentativas. Atingir o limite deverá interromper apenas
as sugestões de IA.

### AI-RNF-007 — Reprodutibilidade

Cada sugestão deverá identificar modelo, prompt, contrato, regras determinísticas
e hash da entrada. O produto não prometerá igualdade textual entre execuções de
modelos probabilísticos.

### AI-RNF-008 — Localização

Mensagens para usuários, explicações e conteúdo exportado deverão estar em
português. Códigos técnicos internos poderão permanecer em inglês.

## 12. Configuração prevista

```env
LLM_MATCH_ADVISOR_MODE=DISABLED
LLM_MATCH_ADVISOR_URL=https://n8n-interno/webhook/reconciliation-advisor-v1
LLM_MATCH_ADVISOR_SECRET=secret-managed-outside-source-control
LLM_MATCH_ADVISOR_TIMEOUT_MS=15000
LLM_MATCH_MAX_GROUPS_PER_REQUEST=20
LLM_MATCH_MAX_CANDIDATES_PER_GROUP=20
LLM_MATCH_PROMPT_VERSION=match-advisor-v1
```

Valores finais deverão ser definidos por ambiente. Segredos não poderão ser
adicionados aos arquivos versionados.

## 13. Estratégia de testes

### 13.1 Testes unitários do core

- gerar somente candidatos elegíveis;
- manter ordem e IDs determinísticos;
- impedir candidato já conciliado;
- rejeitar ID desconhecido;
- rejeitar reutilização;
- rejeitar escopo incompatível;
- rejeitar valor ou soma incompatível;
- preservar evidências canônicas;
- garantir `REVIEW_REQUIRED`;
- garantir que sugestões não alterem totais confirmados.

### 13.2 Testes unitários do runtime

- assinar corretamente a chamada;
- aplicar timeout;
- limitar corpo e resposta;
- validar tipo de conteúdo;
- abrir e fechar o circuito;
- não registrar conteúdo financeiro;
- retornar fallback em todos os erros previstos.

### 13.3 Testes de contrato do n8n

- validar entrada e saída para cada provedor;
- rejeitar campos adicionais;
- rejeitar texto livre;
- preservar `requestId` e versões;
- assegurar que todos os IDs da resposta vieram da entrada;
- testar timeout, rate limit e resposta parcial;
- testar troca de modelo sem alteração do contrato.

### 13.4 Testes de integração

- executar motor, advisor falso e projeção final;
- executar aplicação e n8n local com provedor simulado;
- confirmar arquivo e linha na interface;
- confirmar arquivo e linha no XLSX;
- confirmar que queda do n8n não falha a conciliação;
- confirmar isolamento entre empresas e execuções.

### 13.5 Testes de segurança

- assinatura ausente ou inválida;
- replay da requisição;
- payload excessivo;
- injeção de prompt em histórico bancário;
- tentativa de retornar ID inventado;
- tentativa de retornar instruções em vez de JSON;
- vazamento em logs e histórico de execução;
- webhook público ou sem autenticação;
- acesso indevido às credenciais.

### 13.6 Avaliação contábil privada

O corpus privado deverá possuir decisões revisadas por profissionais da área. A
avaliação deverá medir separadamente:

- cobertura do gerador de candidatos;
- precisão das sugestões da LLM;
- recall das sugestões;
- falsos positivos;
- falsos negativos;
- IDs inválidos;
- desempenho por banco e layout;
- desempenho por cardinalidade 1:1, 1:N e N:1;
- divergência entre modelos e versões.

Resultados esperados não poderão ser inventados quando não existir oráculo.

## 14. Fases de entrega

### Fase 0 — Baseline e contratos

- congelar o baseline determinístico;
- identificar os resultados elegíveis;
- definir schemas e códigos;
- criar testes que preservem linhas e totais.

**Gate:** toda a suíte atual passa sem IA e o contrato V1 está aprovado.

### Fase 1 — Porta e adapter falso

- criar `LlmMatchAdvisor`;
- criar `DisabledMatchAdvisor`;
- criar `FakeMatchAdvisor`;
- criar gerador e validador;
- integrar sem rede ao processamento.

**Gate:** sugestões falsas válidas aparecem com as evidências originais e não
alteram os totais confirmados.

### Fase 2 — Gateway n8n local

- adicionar n8n à infraestrutura de desenvolvimento;
- criar workflow principal;
- criar provedor simulado;
- implementar `N8nMatchAdvisor`;
- implementar autenticação, timeout e fallback.

**Gate:** testes de contrato, integração e segurança passam sem provedor externo.

### Fase 3 — Primeiro provedor em modo sombra

- configurar o primeiro provedor aprovado;
- executar somente sobre o corpus privado;
- medir custo, latência e qualidade;
- comparar com o oráculo contábil.

**Gate:** nenhuma regressão determinística, nenhum ID inventado e relatório de
avaliação revisado.

### Fase 4 — Sugestões para revisão

- ativar `REVIEW` para combinações homologadas;
- apresentar indicação clara de IA;
- permitir aceitar ou rejeitar individualmente;
- registrar a decisão humana.

**Gate:** rastreabilidade completa na interface, no XLSX e na auditoria.

### Fase 5 — Provedores adicionais

- implementar sub-workflow por provedor;
- repetir contratos, segurança e avaliação;
- atualizar a matriz de homologação;
- documentar troca e rollback.

**Gate:** cada provedor ativo cumpre individualmente todos os gates.

### Fase futura — Automação limitada

A promoção de sugestões para match automático exigirá um novo PRD, aprovação
contábil e jurídica, limiar formal de falsos positivos e mecanismo de rollback.

## 15. Backlog de implementação

### Épico A — Contratos e domínio

- `AI-TASK-001`: criar tipos V1 de requisição e resposta;
- `AI-TASK-002`: criar schemas Zod estritos;
- `AI-TASK-003`: criar a porta `LlmMatchAdvisor`;
- `AI-TASK-004`: criar `DisabledMatchAdvisor` e `FakeMatchAdvisor`;
- `AI-TASK-005`: criar o gerador determinístico de candidatos;
- `AI-TASK-006`: criar a validação pós-LLM;
- `AI-TASK-007`: projetar sugestões em `ReconciliationResult`;
- `AI-TASK-008`: recalcular controles e impedir impacto nos totais confirmados.

### Épico B — Runtime e resiliência

- `AI-TASK-009`: implementar `N8nMatchAdvisor`;
- `AI-TASK-010`: adicionar configuração e feature flags;
- `AI-TASK-011`: implementar autenticação entre serviços;
- `AI-TASK-012`: implementar timeout, limite de tamanho e cancelamento;
- `AI-TASK-013`: implementar circuito e fallback;
- `AI-TASK-014`: integrar o advisor ao processamento assíncrono;
- `AI-TASK-015`: implementar auditoria e métricas sem conteúdo financeiro.

### Épico C — n8n

- `AI-TASK-016`: adicionar ambiente local do n8n;
- `AI-TASK-017`: criar workflow principal V1;
- `AI-TASK-018`: criar workflow de provedor simulado;
- `AI-TASK-019`: criar primeiro sub-workflow de provedor real;
- `AI-TASK-020`: configurar credenciais e restrições de rede;
- `AI-TASK-021`: configurar retenção e expurgo;
- `AI-TASK-022`: versionar exports dos workflows;
- `AI-TASK-023`: documentar publicação e rollback.

### Épico D — Interface e relatório

- `AI-TASK-024`: identificar sugestões da IA na interface;
- `AI-TASK-025`: preservar evidências e links existentes;
- `AI-TASK-026`: implementar aceitação e rejeição individual;
- `AI-TASK-027`: registrar decisão humana;
- `AI-TASK-028`: incluir metadados permitidos no XLSX;
- `AI-TASK-029`: garantir localização integral em português.

### Épico E — Qualidade e homologação

- `AI-TASK-030`: adicionar testes unitários do core;
- `AI-TASK-031`: adicionar testes unitários do runtime;
- `AI-TASK-032`: criar suíte de contrato do n8n;
- `AI-TASK-033`: criar integração local com provedor simulado;
- `AI-TASK-034`: criar testes de segurança;
- `AI-TASK-035`: criar executor de avaliação privada;
- `AI-TASK-036`: criar matriz de homologação;
- `AI-TASK-037`: produzir relatório do modo sombra;
- `AI-TASK-038`: executar regressão completa, lint, typecheck e build.

## 16. Critérios de aceite

O primeiro release estará pronto quando:

1. O modo `DISABLED` produzir exatamente o baseline atual.
2. O modo `SHADOW` não alterar nenhum resultado entregue ao usuário.
3. O modo `REVIEW` adicionar apenas sugestões validadas.
4. Nenhuma sugestão não aprovada compuser os totais conciliados.
5. Toda linha e arquivo exibidos vierem de `SourceEvidence`.
6. Todo ID devolvido pelo n8n tiver pertencido à requisição.
7. Timeout e indisponibilidade do n8n preservarem a execução determinística.
8. Logs e métricas não contiverem dados financeiros.
9. A interface e o XLSX permanecerem integralmente em português.
10. Os testes unitários, de contrato, integração e segurança passarem.
11. O build, lint e typecheck passarem sem processos pendentes.
12. O primeiro modelo possuir relatório privado de avaliação aprovado.
13. Os workflows estiverem versionados e possuírem procedimento de rollback.
14. A matriz indicar explicitamente quais combinações estão homologadas.

## 17. Riscos e mitigação

### Risco: sugestão plausível, mas incorreta

**Mitigação:** revisão humana, validação determinística, corpus homologado e
proibição de automação no primeiro release.

### Risco: o candidato correto não chega à LLM

**Mitigação:** medir cobertura do gerador separadamente e melhorar filtros sem
atribuir esse erro ao modelo.

### Risco: troca de modelo altera o comportamento

**Mitigação:** homologar cada combinação e manter rollback imediato.

### Risco: vazamento de dados financeiros

**Mitigação:** minimizar payload, restringir rede, desabilitar conteúdo em logs,
expurgar execuções e revisar a política do provedor.

### Risco: n8n se tornar ponto único de falha

**Mitigação:** fallback determinístico, timeout e circuito de proteção.

### Risco: workflows sem controle equivalente ao código

**Mitigação:** exportar, versionar, revisar e testar workflows antes da publicação.

### Risco: custo ou latência excessivos

**Mitigação:** enviar apenas resíduos, limitar candidatos e lotes, medir consumo e
interromper chamadas ao atingir o orçamento.

## 18. Decisões registradas

- O n8n será gateway de IA, não motor contábil.
- O motor TypeScript permanecerá a autoridade.
- A aplicação continuará responsável por arquivo e linha do XLSX.
- O n8n receberá registros normalizados, não documentos completos.
- A integração interna usará HTTP autenticado, não MCP.
- A porta `LlmMatchAdvisor` manterá a aplicação substituível e portável.
- A troca de provedor exigirá homologação, ainda que não exija mudança de código.
- Sugestões da IA exigirão revisão humana no primeiro release.
- Automação baseada em IA dependerá de um PRD posterior.

## 19. Referências

- [Documentação oficial do n8n](https://docs.n8n.io/)
- [Execuções no n8n](https://docs.n8n.io/workflows/executions/all-executions/)
- [Auditoria de segurança do n8n](https://docs.n8n.io/hosting/securing/security-audit/)
- [Ambientes e versionamento no n8n](https://docs.n8n.io/source-control-environments/create-environments/)
- [Controles de dados da OpenAI](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
