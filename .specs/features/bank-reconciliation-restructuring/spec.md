# Reestruturação da conciliação bancária

**Fonte de verdade**: `C:/Users/joao.carvalho/Downloads/plano-reestruturacao-conciliacao-bancaria.md`
**Status**: Implementado e validado localmente em 2026-08-09; homologação contábil de release bloqueada pelo oráculo privado

## Objetivo

Transformar a implementação atual em um monólito modular TypeScript que importe extratos e razão de
forma segura, normalize e persista dados reproduzíveis, concilie com evidência, trate exceções e
aplique um workflow auditável de preparação, revisão, aprovação e fechamento.

## Premissas e decisões

| Tema | Decisão | Motivo |
| --- | --- | --- |
| Compatibilidade | Preservar adapters, corpus e fluxo anônimo legado; a API V2 implementa o domínio novo | Evita regressão durante migração incremental |
| Dinheiro | Decimal string no domínio e `Decimal` no PostgreSQL | Elimina ponto flutuante sem controle |
| Agrupamentos | 1:N, N:1 e N:N são sugestões desativadas por padrão | Preserva AD-006 e evita falso positivo automático |
| Identidade | Autorização V2 usa contexto de ator verificável e papéis por empresa | Cumpre segregação sem acoplar provedor de SSO |
| Infraestrutura | Core síncrono e persistente primeiro; fila/objetos continuam adapters opcionais | Preserva AD-007 |
| Layouts | Perfis reutilizáveis, versionados e imutáveis depois de ativados | Evita parser por empresa/conta |

## Requisitos rastreáveis

| ID | Requisito | Critério de aceite | Status |
| --- | --- | --- | --- |
| BR-01 | Domínio organizacional | Representar múltiplas empresas, contas bancárias e contábeis, perfis, políticas e fontes sem duplicar regras | ✅ Verificado |
| BR-02 | Modelo canônico | Todo parser produz contratos únicos com decimal exato, origem, valores brutos, warnings e confiança | ✅ Verificado |
| BR-03 | Persistência | PostgreSQL, migrations, repositórios, idempotência, versões, evidências e auditoria reproduzíveis | ✅ Verificado |
| BR-04 | Pipeline de extrato | Validar arquivo, hash, registrar status, detectar layout, parsear, validar, persistir e auditar | ✅ Verificado |
| BR-05 | Catálogo | Resolver conta, empresa, banco, fingerprint e genérico em ordem, com versões imutáveis | ✅ Verificado |
| BR-06 | Detector seguro | Usar igualdade/palavra completa/regex controlada, conteúdo, margem e bloqueio de ambiguidade | ✅ Verificado |
| BR-07 | Mapeamento assistido | Prévia, cabeçalho, papéis, preview normalizado, confirmação, versão e reutilização | ✅ Verificado |
| BR-08 | Validação bancária | Bloquear saldo, período, natureza, duplicidade, conta, layout ou taxa inválida | ✅ Verificado |
| BR-09 | Razão | Normalizar Protheus com evidência e vínculo contábil no mesmo modelo comparável | ✅ Verificado |
| BR-10 | Matching | Cascata exata/data/descrição, sugestões de agrupamento e evidência completa de cada decisão | ✅ Verificado |
| BR-11 | Exceções | Todo item não conciliado tem tipo, causa, candidatos, responsável, prazo, evidência e histórico | ✅ Verificado |
| BR-12 | Workflow | Preparar, submeter, revisar, rejeitar, aprovar e fechar com guardas, papéis e auditoria | ✅ Verificado |
| BR-13 | Segurança e qualidade | MIME/tamanho/fórmulas/macros, isolamento por empresa, testes, cobertura e mutation gates | ✅ Gate local; ⚠️ release aguarda corpus privado |

## Estados e falhas obrigatórias

- Importações usam `RECEIVED`, `READING`, `LAYOUT_DETECTED`, `PARSING`, `NEEDS_MAPPING`,
  `PARSED_WITH_WARNINGS`, `VALIDATED` ou `REJECTED`.
- Ambiguidade de layout, divergência crítica de saldo, conta incompatível, arquivo duplicado e fonte
  inválida nunca avançam silenciosamente.
- Conciliação fechada é imutável; correção exige novo run/importação e evento de auditoria.
- Rotas V2 rejeitam ator sem acesso à empresa e transições de workflow inválidas.

## Fora de escopo desta reestruturação

- Integração direta com ERP, conectores bancários, IA e auto-postagem de ajustes (Fase 13 do PRD).
- Escolha de provedor corporativo de identidade; o core fornece contrato e verificação de autorização.
- Homologação contábil inventada para corpus privado sem oráculo revisado.

## Definição de pronto

Os treze requisitos `BR-*` devem estar implementados e cobertos; build, lint, typecheck, todas as
suítes, cobertura crítica e mutation gate devem passar sem skips de release.
