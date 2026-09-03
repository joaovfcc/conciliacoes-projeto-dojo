import { bankAccountsMatch, type ConfirmProcessingRequest, type PreflightResult, type RegisteredAccountMapping } from "@conciliacao/core";
import { PublicRuntimeError } from "@conciliacao/runtime";

/**
 * Trata o cadastro como fonte de autorização para uma conta física já
 * conhecida. Uma ausência no cadastro não impede a confirmação manual, mas
 * uma divergência ou duplicidade registrada nunca pode ser ignorada.
 */
export function enforceRegisteredAccountMappings(
  preflight: PreflightResult,
  input: ConfirmProcessingRequest,
  registeredAccountMappings: readonly RegisteredAccountMapping[],
): ConfirmProcessingRequest {
  const statements = new Map(preflight.statements.map((statement) => [statement.fileId, statement]));
  return {
    ...input,
    mappings: input.mappings.map((mapping) => {
      const linkedPhysicalAccounts = [...(mapping.linkedPhysicalAccounts ?? [])];
      for (const statementFileId of mapping.statementFileIds) {
        const statement = statements.get(statementFileId);
        if (!statement) continue;
        const registeredLedgers = new Set(
          registeredAccountMappings
            .filter((registered) => bankAccountsMatch(registered, statement))
            .map((registered) => registered.ledgerAccount),
        );
        if (registeredLedgers.size === 0) continue;
        if (registeredLedgers.size > 1) {
          throw new PublicRuntimeError(
            "PERSISTED_BANK_ACCOUNT_AMBIGUOUS",
            "A conta bancária do extrato possui vínculos contábeis conflitantes no cadastro. Corrija o cadastro antes de conciliar.",
            422,
          );
        }
        const registeredLedger = [...registeredLedgers][0]!;
        if (registeredLedger !== mapping.ledgerAccount) {
          throw new PublicRuntimeError(
            "PERSISTED_BANK_ACCOUNT_MISMATCH",
            "A conta bancária do extrato está vinculada no cadastro a outra conta contábil. Revise o vínculo cadastrado antes de conciliar.",
            422,
          );
        }
        if (!linkedPhysicalAccounts.some((item) => item.statementFileId === statementFileId)) {
          linkedPhysicalAccounts.push({
            statementFileId,
            bank: statement.bank,
            agency: statement.agency,
            account: statement.account,
            role: "LINKED",
          });
        }
      }
      return {
        ...mapping,
        ...(linkedPhysicalAccounts.length > 0 ? { linkedPhysicalAccounts } : {}),
      };
    }),
  };
}
