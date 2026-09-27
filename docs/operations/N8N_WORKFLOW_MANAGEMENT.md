# Guia Operacional: Gerenciamento e Publicação de Workflows no n8n

Este documento orienta a operação, publicação, segurança, rotação de chaves e procedimentos de emergência para o gateway `LlmMatchAdvisor` no n8n.

## 1. Estrutura de Workflows

- `AI_MATCH_ADVISOR_V1.json`: Workflow principal responsável por receber o webhook HTTP, validar a assinatura HMAC-SHA256 e o timestamp anti-replay, verificar a versão do contrato e despachar a requisição para o sub-workflow ativo.
- `AI_MATCH_ADVISOR_SIMULATED_PROVIDER_V1.json`: Sub-workflow de provedor simulado para testes locais, CI e homologação de infraestrutura sem custos de API.
- `AI_MATCH_ADVISOR_OPENAI_V1.json`: Sub-workflow para provedor OpenAI com retorno estruturado em JSON e temperatura 0.0.

## 2. Configuração de Segurança e Retenção

1. **Autenticação HMAC**:
   - O cabeçalho `X-Advisor-Signature` contém `sha256=${HMAC_SHA256(secret, timestamp + '.' + rawBody)}`.
   - O cabeçalho `X-Advisor-Timestamp` deve estar dentro de uma janela de $\pm 300$ segundos em relação ao relógio do servidor n8n.
2. **Retenção e Expurgo de Dados**:
   - `saveDataErrorExecution: "none"`
   - `saveDataSuccessExecution: "none"`
   - `saveManualExecutions: false`
   - O n8n opera como gateway em trânsito; nenhum dado financeiro é armazenado em banco de dados ou histórico de execuções.
3. **Credenciais**:
   - As chaves de API dos provedores de LLM devem ser configuradas exclusivamente no cofre de credenciais do n8n (`Generic Auth Header` ou `OpenAI Credential`).
   - Nunca exportar workflows com chaves preenchidas ou inseridas diretamente no código JS.

## 3. Procedimento de Rollback de Emergência

Se uma nova versão de modelo ou workflow apresentar anomalias em produção:

1. **Desativação Imediata via Variável de Ambiente (Sem Deploy)**:
   ```bash
   LLM_MATCH_ADVISOR_MODE=DISABLED
   ```
   A aplicação continuará executando 100% das conciliações determinísticas sem interrupção.

2. **Reversão de Workflow no n8n**:
   - Importar a versão anterior versionada em `workflows/n8n/AI_MATCH_ADVISOR_V1.json`.
   - Reativar o workflow no painel administrativo do n8n.
