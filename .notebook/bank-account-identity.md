# Identidade bancária na conciliação
> Vínculo automático exige confirmação; vínculo manual aceita dados parciais sem conflito

Entry: `packages/core/src/normalization.ts:compareBankAccountIdentities()`

Contrato:
- banco por código ou nome canônico; agência e conta ignoram zeros à esquerda
- conta separa número-base e dígito; dígitos explícitos divergentes são conflito
- `CONFIRMED` → vínculo automático quando existe uma única conta compatível
- `PARTIAL` → sem vínculo automático; seleção manual pode prosseguir
- `CONFLICT` → interface e runtime bloqueiam com `BANK_ACCOUNT_MISMATCH`, salvo uma declaração explícita e verificável de escopo lógico

Fluxo:
- `apps/web/src/components/reconciliation-app.tsx:proposeStatementMappings()`
- `apps/web/src/components/reconciliation-app.tsx:confirmedIdentityMappings()`
- `packages/runtime/src/services.ts:validateConfirmation()`

Escopo lógico por execução:
- Uma conta contábil pode receber mais de uma conta física somente quando a pessoa responsável seleciona a conta contábil e marca cada extrato divergente como `LINKED`.
- A declaração carrega banco, agência e conta extraídos do próprio arquivo. O runtime exige `CONFIRMED` entre a declaração e o extrato; uma conta digitada diferente permanece bloqueada.
- O vínculo é evidência da execução, não uma inferência por nome de banco. A relação permanente continua sendo cadastrada no módulo de configuração antes de ser promovida a um perfil oficial.

Agrupamentos:
- O fluxo público mantém 1:1 como única conciliação automática.
- 1:N e N:1 formam apenas `GROUP_SUGGESTION` quando todo o resíduo do mesmo dia, sinal e família semântica fecha exatamente em centavos.
- Combinações arbitrárias, total diário e candidatos que compartilham uma linha não entram nos totais conciliados.

Cadastro:
- `apps/web/src/app/api/companies/[id]/accounts/route.ts:normalizeRegistration()`
- normaliza código bancário, agência, número-base e dígito antes de persistir
- cadastro melhora a confirmação; não seleciona adapter nem homologa layout

XLSX:
- `packages/core/src/statements/layout-detector.ts:matchesInstitutionEvidence()`
- perfil específico exige evidência de instituição; cabeçalho comum não inventa banco
- `packages/core/src/parsers/tabular.ts:parseTabularStatement()` informa o nome original como evidência auxiliar

Regressões:
- `packages/core/tests/unit/bank-identity.test.ts`
- `apps/web/tests/unit/reconciliation-identity.test.ts`
- `tests/security/account-mapping-gate.test.ts`
- `packages/runtime/tests/unit/security.test.ts`
- `packages/core/tests/unit/reconciliation.test.ts`

Updated: 2026-09-01
