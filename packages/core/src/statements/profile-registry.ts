import { StatementLayoutProfile } from "./statement-types.js";
import { ITAU_CHECKING_XLSX_V1 } from "./profiles/itau-checking-xlsx-v1.js";
import { BRADESCO_CHECKING_XLSX_V1 } from "./profiles/bradesco-checking-xlsx-v1.js";
import { BB_CHECKING_XLSX_V1 } from "./profiles/bb-checking-xlsx-v1.js";
import { SANTANDER_CHECKING_XLSX_V1 } from "./profiles/santander-checking-xlsx-v1.js";
import { CAIXA_CHECKING_XLSX_V1 } from "./profiles/caixa-checking-xlsx-v1.js";
import { GENERIC_STATEMENT_V1 } from "./profiles/generic-statement-v1.js";

/**
 * Centralized catalog of all supported tabular statement profiles.
 * Specific bank profiles are prioritized first; GENERIC_STATEMENT_V1 serves as the universal fallback.
 */
export const STATEMENT_PROFILE_REGISTRY: StatementLayoutProfile[] = [
  ITAU_CHECKING_XLSX_V1,
  BRADESCO_CHECKING_XLSX_V1,
  BB_CHECKING_XLSX_V1,
  SANTANDER_CHECKING_XLSX_V1,
  CAIXA_CHECKING_XLSX_V1,
  GENERIC_STATEMENT_V1,
];
