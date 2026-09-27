# Matriz de Homologação de Modelos e Provedores (LlmMatchAdvisor)

Esta matriz documenta o status de homologação de cada combinação de provedor, modelo, versão de prompt e família de layout para o gateway de sugestões via n8n.

## Status Permitidos

- `NOT_TESTED`: Combinação cadastrada mas sem testes executados.
- `SHADOW`: Em avaliação sobre corpus privado em modo sombra; sem exibição ao usuário final.
- `REVIEW_APPROVED`: Homologado para exibição de sugestões para revisão humana na interface e XLSX.
- `BLOCKED`: Bloqueado por violação de critérios de qualidade contábil ou segurança.
- `RETIRED`: Descontinuado ou substituído por versão mais recente.

---

## Matriz de Homologação V1

| Provedor | Modelo | Versão do Prompt | Família de Layout / Banco | Status | Data de Aprovação | Responsável |
|---|---|---|---|---|---|---|
| `simulated` | `simulated-v1` | `match-advisor-v1` | Todas as famílias | `REVIEW_APPROVED` | 2026-09-08 | QA / Engenharia |
| `openai` | `gpt-4o-mini` | `match-advisor-v1` | Extratos Itaú / Bradesco / BB | `SHADOW` | 2026-09-08 | Controladoria / IA |
| `openai` | `gpt-4o` | `match-advisor-v1` | Extratos Genéricos / PDF | `SHADOW` | 2026-09-08 | Controladoria / IA |
| `anthropic` | `claude-3-5-haiku` | `match-advisor-v1` | Todas as famílias | `NOT_TESTED` | — | — |
| `google` | `gemini-1.5-flash` | `match-advisor-v1` | Todas as famílias | `NOT_TESTED` | — | — |

---

## Regras de Promoção de Status

1. **Promoção de `NOT_TESTED` para `SHADOW`**:
   - Teste de contrato Zod V1 aprovado com 100% de conformidade.
   - Nenhuma credencial exposta em logs ou exports.
2. **Promoção de `SHADOW` para `REVIEW_APPROVED`**:
   - Zero IDs inventados em 100% das execuções do corpus privado.
   - Zero divergência monetária em centavos (`BigInt`).
   - Precisão mínima e recall contábil validados por amostragem humana.
   - Relatório de avaliação contábil aprovado.
