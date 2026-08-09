import type { StatementLayoutProfile } from "../../statements/statement-types.js";
import type { TabularSourceFormat } from "../../tabular/tabular-types.js";

export type ColumnRole = "DATE" | "DESCRIPTION" | "DOCUMENT" | "AMOUNT" | "DEBIT" | "CREDIT" | "BALANCE" | "NATURE";

export interface LayoutFingerprint {
  format: TabularSourceFormat;
  normalizedHeaders: string[];
  columnCount: number;
  headerRowIndex: number;
  detectedColumnTypes: string[];
  bankHints: string[];
  sheetHints: string[];
  fingerprintHash: string;
}

export interface AccountLayoutBinding {
  id: string;
  bankAccountId: string;
  layoutId: string;
  layoutVersion: number;
  priority: number;
  status: "ACTIVE" | "INACTIVE";
  customOverrides?: Record<string, unknown>;
}

export interface LayoutCatalogEntry {
  profile: StatementLayoutProfile;
  scope: "ACCOUNT" | "COMPANY" | "BANK" | "GLOBAL";
  fingerprintHash?: string;
  bankAccountId?: string;
  companyId?: string;
  bankCode?: string;
  priority: number;
}
