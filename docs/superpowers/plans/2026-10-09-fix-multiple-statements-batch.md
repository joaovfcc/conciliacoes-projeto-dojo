# Plano de Implementação: Suporte Resiliente a Múltiplos Extratos em Lote

> **Meta:** Permitir que o usuário envie múltiplos extratos bancários de uma vez (incluindo contas sem movimentação ou com rodapés de saldo), extraindo corretamente os dados cadastrais, ignorando totalizadores espúrios e permitindo conciliar as contas ativas sem bloqueios ou impasses de mapeamento.

**Arquitetura:** 
1. No `@conciliacao/core`, ajustar o `layout-detector` para pontuar cabeçalhos mesmo sem lançamentos amostrais (`NO_CONTENT_SAMPLE`), preservar a extração de agência/conta do extrato vazio e refinar `stopPatterns`/`ignoreRowPatterns` contra linhas de totalizadores.
2. No `preflight.ts`, rebaixar `TABULAR_SEM_MOVIMENTOS` de `ERROR` para `WARNING`, marcando o arquivo como `reconciliationEligible: false`.
3. No `@conciliacao/web`, permitir que extratos não elegíveis ou sem movimentação não impeçam a confirmação e fornecer controle para ignorar/desmarcar extratos específicos do lote.

**Stack:** TypeScript, Vitest, React, Next.js.

---

## Restrições Globais (QA Gate & Deep Workflow)
- **Zero Falso Positivo:** Linhas de total/resumo (`TOTAL R$`, `TOTAL DISPONÍVEL`) nunca devem ser convertidas em transações contábeis/bancárias.
- **Não Regressão:** Extratos bancários reais com movimentação normal (Bradesco, Itaú, BB, Santander) devem continuar passando com 100% de precisão e `balanceCheck` válido.
- **Validação de Tipagem e Build:** `pnpm --filter @conciliacao/core build` e `pnpm --filter @conciliacao/web test:components` devem passar sem alertas ou erros.

---

### Tarefa 1: Resiliência do `layout-detector` para Extratos Sem Movimentação

**Arquivos:**
- Modificar: `packages/core/src/statements/layout-detector.ts`
- Testes: `packages/core/tests/unit/statements/layout-detector.test.ts`

**Problema:** Quando a tabela não tem linhas de transação, `contentScore` retorna `warnings: ["NO_CONTENT_SAMPLE"]`. Isso força `requiresReview: true`, fazendo `detectLayout` retornar `null`, perdendo os dados de banco/agência/conta.

- [ ] **Passo 1.1: Criar teste de unidade demonstrando a falha**
  Criar teste onde uma planilha tem cabeçalhos institucionais completos do Bradesco e número da conta, mas nenhuma linha de movimentação. Verificar que `detectLayout` atualmente retorna `null`.
- [ ] **Passo 1.2: Executar teste e validar a falha**
  Executar: `pnpm --filter @conciliacao/core test:unit -t "layout-detector"`
- [ ] **Passo 1.3: Ajustar `layout-detector.ts`**
  Quando `score` de cabeçalhos institucionais + grupos obrigatórios for elevado (ex: $\ge 80$), a ausência de amostra (`NO_CONTENT_SAMPLE`) não deve anular o match do leiaute quando os cabeçalhos distintivos e obrigatórios estiverem presentes.
- [ ] **Passo 1.4: Executar testes de unidade do layout-detector**
  Garantir que o novo teste passa e nenhum teste existente foi quebrado.

---

### Tarefa 2: Eliminar Falsos Positivos de Rodapés e Totalizadores no Parser do Bradesco

**Arquivos:**
- Modificar: `packages/core/src/statements/profiles/bradesco-checking-xlsx-v1.ts`
- Modificar: `packages/core/src/statements/generic-statement-parser.ts`
- Testes: `packages/core/tests/unit/statements/multi-bank-xlsx.test.ts`

**Problema:** Linhas de rodapé como `TOTAL R$ 242.87`, `TOTAL DISPONÍVEL` e textos de extrato vazio contendo valores numéricos são interpretados como transações válidas e geram períodos inválidos (ex: `202608`).

- [ ] **Passo 2.1: Criar teste negativo no `multi-bank-xlsx.test.ts`**
  Adicionar caso de teste com planilha do Bradesco contendo a mensagem *"NÃO HÁ LANÇAMENTOS PARA ESTE TIPO DE EXTRATO"* e as linhas de rodapé `TOTAL R$ 242.87` / `TOTAL DISPONÍVEL 242.87`.
  O teste deve comprovar que **zero transações** são extraídas e nenhum período inválido é gerado.
- [ ] **Passo 2.2: Executar teste e validar a falha (verificar que extrai falso positivo)**
- [ ] **Passo 2.3: Atualizar padrões de parada e ignorar linhas**
  - Em `bradesco-checking-xlsx-v1.ts`:
    - Adicionar a `stopPatterns` e `ignoreRowPatterns`: `"total r$"`, `"total disponível"`, `"total disponivel"`, `"não há lançamentos"`, `"nao ha lancamentos"`, `"conta-corrente"`.
  - Em `generic-statement-parser.ts`:
    - Garantir que `stopPatterns` encerre imediatamente o loop de linhas de dados antes de processar totalizadores de rodapé.
- [ ] **Passo 2.4: Executar testes e verificar que passa**

---

### Tarefa 3: Rebaixar `TABULAR_SEM_MOVIMENTOS` de `ERROR` para `WARNING` e Marcar Não Elegível

**Arquivos:**
- Modificar: `packages/core/src/preflight.ts`
- Modificar: `packages/core/src/tabular/sheet-classifier.ts` (ou onde a issue é emitida)
- Testes: `packages/core/tests/unit/files.test.ts` e novos testes de preflight

**Problema:** `TABULAR_SEM_MOVIMENTOS` como `ERROR` bloqueia toda a sessão do preflight, impedindo a conciliação das outras contas que possuem movimentação.

- [ ] **Passo 3.1: Escrever teste de pré-análise com lote misto (1 razão + 1 extrato ativo + 1 extrato sem movimentação)**
  Verificar que o extrato ativo é processado normalmente, o extrato sem movimentação recebe severidade `WARNING`, `reconciliationEligible: false`, e `requiresUserInput` não bloqueia a execução por erro fatal.
- [ ] **Passo 3.2: Executar teste e confirmar o comportamento atual bloqueado**
- [ ] **Passo 3.3: Ajustar emissão da issue e marcação de elegibilidade**
  - Extratos sem registros válidos devem ser classificados com severidade `WARNING` e `reconciliationEligible = false`.
- [ ] **Passo 3.4: Executar testes do core e validar passagem**

---

### Tarefa 4: Ajustes na Interface Web (`apps/web`) para Lotes com Múltiplos Extratos

**Arquivos:**
- Modificar: `apps/web/src/components/reconciliation-app.tsx`
- Testes: `apps/web/tests/components/reconciliation-app.test.tsx`

**Problema:**
1. A tela de confirmação exige mapeamento de todos os extratos elegíveis, travando caso haja extratos extras.
2. Se um extrato tiver conflito de conta, mas agência/conta não foram extraídas, a checkbox de confirmação fica desabilitada (deadlock).
3. Não há opção de "ignorar extrato" diretamente na tela de confirmação.

- [ ] **Passo 4.1: Escrever teste de componente no `reconciliation-app.test.tsx`**
  Simular preflight com 1 extrato ativo e 1 extrato sem movimentação (ou não mapeado), validando que o botão de "Confirmar e conciliar" fica habilitado para a conta mapeada.
- [ ] **Passo 4.2: Ajustar lógica de `mappingsComplete` e `Confirmation`**
  - Extratos sem movimentação (`reconciliationEligible === false` ou `records === 0`) devem ser exibidos em seção informativa (sem exigir conta contábil).
  - Permitir opção explícita no dropdown de conta: `"[Ignorar este extrato nesta execução]"` para permitir descartar um extrato sem precisar reiniciar todo o fluxo de arquivos.
  - Se a severidade da issue de um arquivo for apenas `WARNING`, `blocked` não deve ser ativado.
- [ ] **Passo 4.3: Executar testes de componentes da web**
  Executar: `pnpm --filter @conciliacao/web test:components`

---

### Tarefa 5: Validação Integrada de Ponta a Ponta (QA Gate)

- [ ] **Passo 5.1: Executar preflight real com os 5 extratos do Bradesco do usuário**
  Executar script de validação para confirmar que:
  - O extrato `0003802-4` (com 135 lançamentos) é mapeado corretamente.
  - Os 4 extratos sem movimentação são identificados com suas contas bancárias, recebem status informativo/warning e não geram transações fantasmas.
  - Apenas o período `202512` é detectado (eliminando `202608`).
- [ ] **Passo 5.2: Executar suite de testes do monorepo**
  - `pnpm --filter @conciliacao/core build`
  - `pnpm --filter @conciliacao/core test:unit`
  - `pnpm --filter @conciliacao/web test:components`
  - `pnpm --filter @conciliacao/web build`
