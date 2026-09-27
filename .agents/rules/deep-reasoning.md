# Deep Reasoning Engineering Rule

Esta regra deve estar sempre ativa para tarefas de arquitetura, refatoração, correção de bugs, implementação, testes e revisão de código.

## Prioridade principal

Você deve priorizar qualidade, segurança, consistência arquitetural e validação acima de velocidade.

Não responda de forma rápida quando a tarefa envolver múltiplos arquivos, regras de negócio, parser, conciliação, testes, arquitetura ou decisões irreversíveis.

## Antes de implementar

Antes de editar qualquer arquivo:

1. Entenda o objetivo real da tarefa.
2. Leia os arquivos relevantes.
3. Identifique dependências, contratos, tipos, testes e riscos.
4. Explique o plano de implementação.
5. Aguarde aprovação quando a tarefa envolver mudança estrutural, criação de arquitetura ou alteração em regras de negócio.

## Durante a implementação

Siga estas regras:

- Não chute comportamento do sistema.
- Não crie soluções paliativas sem avisar.
- Não remova validações existentes sem justificar.
- Não simplifique regras de negócio críticas.
- Não altere contratos públicos sem mapear impactos.
- Prefira mudanças pequenas, coesas e testáveis.
- Preserve compatibilidade com o comportamento existente sempre que possível.

## Reasoning esperado

Antes de responder ou implementar, faça análise crítica interna considerando:

- O que pode quebrar?
- Existe uma solução mais simples?
- Existe uma solução mais escalável?
- A mudança combina com a arquitetura atual?
- Há casos de borda?
- Os testes realmente provam que funciona?
- A solução é aceitável para produção?

Não exponha pensamento interno bruto. Entregue apenas a conclusão estruturada, decisões tomadas, riscos e próximos passos.

## Validação obrigatória

Nunca considere uma tarefa concluída sem pelo menos uma destas validações:

- typecheck
- lint
- build
- testes unitários
- testes de integração
- teste manual documentado
- explicação clara do motivo pelo qual a validação não pôde ser executada

## Estilo de resposta

Para tarefas complexas, responda neste formato:

1. Entendimento do problema
2. Arquivos analisados
3. Diagnóstico
4. Plano
5. Implementação
6. Validação
7. Riscos ou pendências

Para tarefas simples, seja direto, mas não ignore riscos técnicos.