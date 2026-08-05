# PRD — Aplicação pública de conciliação bancária

**Versão:** 2.0  
**Status:** aprovado para implementação do MVP  
**Atualização:** 1º de agosto de 2026

## 1. Resumo executivo

A aplicação compara um razão gerado pelo ERP Protheus com um a cinco extratos bancários. O uso é feito integralmente pelo navegador, sem terminal, instalação, login, cadastro ou identificação do visitante. A conferência principal ocorre em tela; o XLSX completo, sem macros, é uma opção de download.

A aplicação é pública, mas cada execução é isolada por um token secreto temporário. Não existe histórico, listagem ou recuperação em outro navegador. Arquivos e resultados financeiros são temporários e devem ser eliminados ao concluir, falhar, fechar, abandonar ou atingir o limite de duas horas.

Este documento substitui as decisões anteriores de autenticação corporativa, perfis, banco relacional, configuração de contas por XLSX montado no deploy e hospedagem obrigatória na Vercel. O identificador `WEB-RF-001` foi removido e não será reutilizado.

## 2. Objetivos e fora de escopo

### Objetivos

- permitir uso por pessoas sem conhecimento técnico;
- aceitar qualquer empresa, filial e conta, sem cadastro prévio;
- detectar e confirmar metadados antes da conciliação;
- preservar as regras conservadoras um-para-um 1–9;
- exibir resumo, detalhes e evidências em tela;
- gerar o XLSX completo somente sob demanda;
- funcionar em qualquer infraestrutura que execute containers, Redis compatível e storage S3 compatível;
- não deixar resíduos financeiros depois do encerramento ou TTL.

### Fora do escopo do MVP

- autenticação, SSO, OAuth, Entra ID, usuários, organizações, papéis e permissões;
- histórico, recuperação de sessão, comentários, aprovação ou alteração de resultado;
- banco relacional;
- integração direta com Protheus ou bancos;
- agrupamentos muitos-para-muitos;
- XLSM, macros ou conteúdo ativo;
- fornecedor de nuvem obrigatório.

## 3. Jornada principal

1. O visitante abre a aplicação pública.
2. Aceita o aviso de autorização, processamento temporário, eliminação e impossibilidade de recuperação.
3. Envia exatamente um razão CSV ou XLSX.
4. Envia de um a cinco extratos CSV, XLSX, OFX ou PDF.
5. Informa a tolerância monetária, em decimal exato.
6. A aplicação valida os arquivos e executa a pré-análise.
7. A tela mostra empresa, filial, competências, contas contábeis, banco, agência, contas bancárias, registros, alertas e rejeições.
8. O visitante confirma os metadados detectados e seleciona explicitamente a competência quando houver mais de uma.
9. O worker executa extração, OCR quando necessário, normalização e conciliação.
10. O resultado aparece no dashboard e nas tabelas de conferência.
11. O visitante pode baixar o XLSX completo.
12. Encerrar, abandonar ou exceder o TTL cancela a execução e elimina seus dados.

## 4. Requisitos funcionais

### WEB-RF-002 — Acesso anônimo e isolamento

- A aplicação é acessível sem autenticação.
- Ao criar uma sessão, o servidor gera um token aleatório de 256 bits.
- O navegador mantém o token apenas em `sessionStorage` e memória.
- O servidor persiste somente o hash SHA-256 do token.
- O token não pode aparecer em URL, log ou telemetria.
- Todas as rotas de uma execução exigem o token por `Authorization: Bearer`.
- O fechamento via `sendBeacon` pode enviar o token no corpo da requisição, nunca na URL.
- Uma sessão não consulta nem altera outra, inclusive quando conhece seu identificador.
- Não existe endpoint de listagem de sessões.

### WEB-RF-003 — Tela inicial

A tela deve explicar o objetivo, os formatos, a temporalidade dos dados e os limites. O botão de início permanece desabilitado até o aceite do aviso.

### WEB-RF-005 — Criação da execução

A criação não solicita empresa, conta ou usuário. Deve rejeitar excesso de sessões por IP antes de aceitar uploads e retornar resposta sem cache.

### WEB-RF-006 — Upload privado

- O upload usa nome físico aleatório, sem dados financeiros no caminho.
- Em S3, a autorização dura no máximo cinco minutos e é vinculada à sessão, ao tipo e ao tamanho esperados.
- No modo local de desenvolvimento, a API recebe o corpo autenticado.
- Upload incompleto, rejeitado ou duplicado é removido sem deixar objeto órfão.

### WEB-RF-007 — Formatos

- razão: exatamente um arquivo CSV ou XLSX;
- extratos: entre um e cinco arquivos CSV, XLSX, OFX ou PDF;
- XLS, XLSM e demais formatos são rejeitados.

### WEB-RF-008 — Validação de entrada

Validar extensão, MIME declarado, assinatura real, tamanho, quantidade, duplicidade SHA-256, antivírus, estrutura XLSX, taxa de compressão, quantidade de entradas, tamanho expandido e total de páginas do PDF antes do parser aplicável.

### WEB-RF-009 — Idempotência

`confirm-and-process` exige `idempotencyKey`. Repetir a mesma chave para a mesma sessão não cria outro job nem duplica resultados.

### WEB-RF-011 — Leitura do razão

- Aceitar relatórios Protheus com múltiplas abas, parâmetros, cabeçalhos repetidos e conta em linha `CONTA - ...`.
- Detectar empresa, filial, competência e contas por cabeçalhos, metadados e registros.
- Solicitar empresa ou filial ausente na confirmação.
- Bloquear razões com várias empresas.
- Exigir escolha quando houver várias competências.
- Rejeitar registros fora da competência confirmada e informar quantidade e motivo.

### WEB-RF-012 — PDF pesquisável

Extrair texto e evidência por página. Não executar OCR em página cuja extração textual tenha conteúdo suficiente.

### WEB-RF-013 — OCR

PDF digitalizado é renderizado com Poppler e reconhecido com Tesseract no ambiente isolado do worker. O resultado registra método e confiança. Informação ausente ou de baixa confiança exige confirmação.

### WEB-RF-014 — Detecção de layout

Detectar banco, agência, conta e período pelo conteúdo, nunca pelo nome do arquivo. Os layouts homologados são conta corrente Bradesco, BRB, Itaú, Santander e Sofisa; investimento Bradesco, Itaú e Santander; e posição de renda fixa Sofisa. Layout desconhecido é rejeitado sem criar transações.

Somente documentos `CURRENT_ACCOUNT` participam da conciliação. `INVESTMENT_ACTIVITY` e `INVESTMENT_POSITION` são informativos, não exigem mapeamento para conta contábil e não podem alimentar uma regra de conciliação. Colunas de saldo nunca podem se tornar lançamentos.

### WEB-RF-015 — Normalização

Datas são normalizadas para ISO, documentos para comparação estável e valores para decimal exato. Cada registro preserva arquivo, linha ou página, parser, método e confiança.

### WEB-RF-016 — Conciliação

- Manter conciliação um-para-um somente dentro do mapeamento conta contábil × conta bancária confirmado.
- Exigir evidência forte e candidato único para automação: documento, data e valor exatos; documento e valor com data dentro da tolerância; ou valor e data com documento ausente em pelo menos uma origem.
- Tratar igualdade isolada de valor como `VALUE_ONLY_SUGGESTION`, nunca como conciliação automática.
- Mostrar divergência de valor, divergência de data e ambiguidade como estados distintos de revisão.
- Não reutilizar registro conciliado.
- Nunca escolher automaticamente entre múltiplos candidatos.
- Não implementar agrupamentos no MVP.
- As tolerâncias monetária e de data são explícitas; a monetária é string decimal validada e convertida para `Decimal`.

### WEB-RF-017 — Identificação das contas

- Banco, agência, conta bancária e conta contábil são detectados e exibidos como evidência.
- O visitante deve relacionar cada extrato elegível a uma conta contábil antes da execução.
- Banco, agência ou conta incompatível bloqueiam a execução com `BANK_ACCOUNT_MISMATCH`; metadado ausente bloqueia com `ACCOUNT_IDENTITY_MISSING`.
- Somente extratos de conta corrente com mapeamento confirmado participam da comparação.

### WEB-RF-018 — Resumo em tela

Exibir saldos, diferença, conciliados, divergências, ausências, ambiguidades, duplicidades e erros por conta e no total.

### WEB-RF-019 — Detalhes e evidência

Disponibilizar abas de Conciliados, Divergências, Razão sem extrato, Extrato sem razão, Ambiguidades e duplicidades, Investimentos e Arquivos e erros. As tabelas são somente leitura, paginadas e filtráveis. A aba Investimentos exibe aplicações, resgates, rendimentos e posições apenas para conferência. O painel de evidência mostra os dois lados, regra, motivo, arquivo, linha/página, parser e confiança OCR.

### WEB-RF-021 — Exportação XLSX

- Gerar apenas sob demanda e em memória.
- Transmitir e descartar sem persistência.
- Exportar a execução completa em nove abas, incluindo `Investimentos`.
- Usar a mesma fonte de resultados da interface.
- Neutralizar `=`, `+`, `-` e `@` no início de conteúdo do usuário.
- Nunca incluir macros.

### WEB-RF-026 — Cancelamento

Cancelamento explícito, fechamento e expiração devem marcar cancelamento, impedir ressurreição da sessão, interromper o job em ponto seguro, terminar subprocessos e iniciar limpeza idempotente.

### WEB-RF-027 — Retenção e exclusão

- heartbeat a cada 30 segundos;
- tolerância de cinco minutos sem heartbeat;
- reconexão dentro da tolerância preserva a execução;
- limite absoluto de duas horas desde a criação;
- `sendBeacon` solicita limpeza imediata no fechamento;
- arquivos são apagados ao concluir ou falhar definitivamente;
- resultados permanecem no Redis somente enquanto a página está ativa;
- lifecycle do storage remove resíduos após duas horas;
- apenas métricas técnicas anônimas ficam por 30 dias.

## 5. APIs

```text
POST /api/sessions
POST /api/sessions/{id}/uploads/authorize
PUT  /api/sessions/{id}/uploads/{fileId}       # modo local
POST /api/sessions/{id}/uploads/complete
POST /api/sessions/{id}/preflight
POST /api/sessions/{id}/confirm-and-process
POST /api/sessions/{id}/heartbeat
POST /api/sessions/{id}/cancel
POST /api/sessions/{id}/close
GET  /api/sessions/{id}/status
GET  /api/sessions/{id}/summary
GET  /api/sessions/{id}/results
GET  /api/sessions/{id}/export.xlsx
```

```ts
type ConfirmProcessingRequest = {
  company: string;
  branch?: string;
  period: string;
  valueTolerance: string;
  idempotencyKey: string;
};
```

Não haverá rota de listagem, recuperação ou histórico.

## 6. Estados

```text
DRAFT → UPLOADING → READY → PREFLIGHT → AWAITING_CONFIRMATION
      → QUEUED → VALIDATING/EXTRACTING/OCR_PROCESSING/RECONCILING
      → COMPLETED | COMPLETED_WITH_ISSUES | FAILED

qualquer estado ativo → CANCELLING → CANCELLED
sem heartbeat ou TTL absoluto → EXPIRED
```

## 7. Limites públicos

Todos os valores são configuráveis por ambiente; estes são os padrões:

| Escopo | Limite |
|---|---:|
| sessões ativas por IP | 1 |
| novas sessões por IP/janela móvel de 1 hora | 3 |
| razão por sessão | 1 |
| extratos por sessão | 5 |
| tamanho por arquivo | 25 MB |
| tamanho por sessão | 75 MB |
| páginas por PDF | 100 |
| OCR simultâneo | 2 jobs |
| fila aguardando | 20 jobs |
| TTL sem heartbeat | 5 minutos |
| TTL absoluto | 2 horas |

Ao lotar a fila, responder `429` ou `503`, incluir `Retry-After` e não preservar uploads da tentativa rejeitada. O IP só pode vir de cabeçalhos definidos por proxies confiáveis; a borda deve remover cabeçalhos fornecidos diretamente pelo visitante.

## 8. Arquitetura portável

```text
Navegador
  → reverse proxy/WAF (HTTPS, limites e cabeçalhos)
  → web: Next.js/React, Node, TypeScript strict
      → Redis compatível: sessão, resultado, rate limit e BullMQ
      → storage S3 compatível: objetos privados e temporários
  → worker TypeScript
      → antivírus → parser → Poppler/Tesseract → motor → Redis
```

- `apps/web`: interface, rotas e upload;
- `apps/worker`: consumidor BullMQ com concorrência configurável;
- `packages/core`: normalização, conciliação e XLSX sem dependência de provedor;
- `packages/runtime`: sessões, storage, segurança, fila e lifecycle;
- `infra/compose.yaml`: referência local portável com Redis e MinIO;
- Python permanece como baseline de paridade durante a migração.

Não há banco relacional. Resultados financeiros existem somente no cache temporário.

## 9. Segurança e privacidade

- HTTPS obrigatório fora do desenvolvimento;
- CORS para a própria origem, CSP, `nosniff`, política de referência e proteção de frame;
- `robots.txt` e metadado `noindex, nofollow`;
- bucket privado e chaves aleatórias;
- antivírus antes dos parsers;
- rejeição de macro, MIME falso, ZIP bomb e PDF acima do limite;
- worker sem root, sem privilégios, raiz somente leitura, `/tmp` isolado e rede de saída bloqueada;
- limites de CPU, memória, tempo e concorrência definidos no orquestrador;
- Poppler, Tesseract e antivírus recebem argumentos fixos, sem shell;
- nenhum conteúdo financeiro, token, nome original, empresa, conta ou documento entra em log, métrica ou erro público;
- erros públicos usam código técnico estável e mensagem sanitizada;
- limpeza e cancelamento são idempotentes;
- storage deve possuir regra de lifecycle independente para duas horas.

## 10. Critérios de aceite

1. Um visitante conclui o fluxo sem login e sem terminal.
2. O token tem 256 bits, fica em `sessionStorage`, é persistido apenas por hash e não aparece em URL/log.
3. Um token não acessa outra sessão e não existe listagem.
4. O fluxo exige um razão, de um a cinco extratos e a tolerância monetária.
5. Todos os extratos de conta corrente enviados são incluídos na comparação com o razão da empresa confirmada.
6. Razão com múltiplas empresas é bloqueado; múltiplas competências exigem escolha.
7. Layout desconhecido, macro, assinatura falsa, ZIP bomb e PDF excedente são rejeitados sem resíduos.
8. A fila limita 20 aguardando e o worker limita dois jobs concorrentes por padrão.
9. A tela e o XLSX usam o mesmo resultado; o XLSX contém oito abas e neutraliza fórmulas.
10. Fechamento, cancelamento, cinco minutos sem heartbeat e duas horas absolutas eliminam todos os dados financeiros.
11. A telemetria contém apenas eventos técnicos anônimos.
12. O baseline 2025-12 mantém 2.056 registros do razão, 1.723 do extrato, diferença de R$ 0,02 e 562 conciliações um-para-um, salvo mudança formalmente justificada.

## 11. Estratégia de testes

- unitários: decimal, datas, regras 1–9, ambiguidade, duplicidade, comparação entre múltiplas contas e exportação;
- integração: CSV/XLSX/OFX/PDF, S3, Redis, BullMQ, antivírus, Poppler e Tesseract;
- segurança: tokens cruzados, macros, MIME falso, ZIP bomb, PDF adverso, formula injection e ausência de dados sensíveis em logs;
- lifecycle: heartbeat, reconexão, cancelamento, fechamento, TTL, job em andamento e ausência total de resíduos;
- capacidade: limite por IP, fila cheia, `Retry-After` e concorrência de OCR;
- paridade: execução do baseline histórico contra Python e TypeScript;
- E2E: jornada completa no navegador, conferência em tela e download das oito abas.

## 12. Implantação

O destino é uma decisão operacional, não de produto. Qualquer plataforma é válida se oferecer containers, HTTPS, proxy confiável, Redis compatível, storage S3 privado, lifecycle de objetos, rede interna e controles de recursos. Vercel pode hospedar partes compatíveis, mas não é requisito nem referência arquitetural obrigatória.
