import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  SqliteCompletedReconciliationRepository,
  type Company,
  type RegisteredAccountMapping,
} from "@conciliacao/core";

export type LocalBankAccount = {
  id: string;
  companyId: string;
  bankCode: string | null;
  bankName: string | null;
  agency: string | null;
  accountNumber: string | null;
  accountDigit: string | null;
  accountType: string;
  currency: string;
  status: string;
  createdAt: string;
};

export type LocalLedgerAccount = {
  id: string;
  companyId: string;
  code: string;
  description: string;
  sourceSystem: string;
  status: string;
  createdAt: string;
};

export type LocalAccountMapping = {
  id: string;
  companyId: string;
  status: string;
  bankAccount: LocalBankAccount;
  ledgerAccount: LocalLedgerAccount;
};

let dbInstance: DatabaseSync | null = null;
let repoInstance: SqliteCompletedReconciliationRepository | null = null;

export function getLocalDb(): DatabaseSync {
  if (!dbInstance) {
    const dbPath = resolve(process.cwd(), "..", "..", "dados.db");
    // Fallback if running from root
    const finalPath = process.cwd().endsWith("web") ? dbPath : resolve(process.cwd(), "dados.db");
    dbInstance = new DatabaseSync(finalPath);
    initTables(dbInstance);
  }
  return dbInstance;
}

function initTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      legal_entity_id TEXT NOT NULL,
      name TEXT NOT NULL,
      document_number TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
      default_currency TEXT NOT NULL DEFAULT 'BRL'
    );

    CREATE TABLE IF NOT EXISTS bank_accounts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      bank_code TEXT,
      bank_name TEXT,
      agency TEXT,
      account_number TEXT,
      account_digit TEXT,
      account_type TEXT NOT NULL DEFAULT 'CHECKING',
      currency TEXT NOT NULL DEFAULT 'BRL',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ledger_accounts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT NOT NULL,
      source_system TEXT NOT NULL DEFAULT 'PROTHEUS',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      UNIQUE(company_id, code)
    );

    CREATE TABLE IF NOT EXISTS bank_ledger_mappings (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      bank_account_id TEXT NOT NULL,
      ledger_account_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      UNIQUE(bank_account_id, ledger_account_id)
    );

    INSERT OR IGNORE INTO companies (id, organization_id, legal_entity_id, name, status)
    VALUES ('org-default-001', 'org-default-001', 'entity-001', 'Empresa Principal', 'ACTIVE');
  `);
}

export function getLocalReconciliationRepository(): SqliteCompletedReconciliationRepository {
  if (!repoInstance) {
    repoInstance = new SqliteCompletedReconciliationRepository(getLocalDb());
  }
  return repoInstance;
}

export function listLocalCompanies(): Company[] {
  const db = getLocalDb();
  const rows = db.prepare(`SELECT * FROM companies WHERE status = 'ACTIVE' ORDER BY name ASC`).all() as Array<{
    id: string;
    organization_id: string;
    legal_entity_id: string;
    name: string;
    document_number: string | null;
    status: "ACTIVE" | "INACTIVE";
    timezone: string;
    default_currency: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    legalEntityId: r.legal_entity_id,
    name: r.name,
    ...(r.document_number ? { documentNumber: r.document_number } : {}),
    status: r.status,
    timezone: r.timezone,
    defaultCurrency: r.default_currency,
  }));
}

export function findLocalCompanyById(id: string): Company | null {
  const db = getLocalDb();
  const r = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(id) as {
    id: string;
    organization_id: string;
    legal_entity_id: string;
    name: string;
    document_number: string | null;
    status: "ACTIVE" | "INACTIVE";
    timezone: string;
    default_currency: string;
  } | undefined;

  if (!r) return null;
  return {
    id: r.id,
    organizationId: r.organization_id,
    legalEntityId: r.legal_entity_id,
    name: r.name,
    ...(r.document_number ? { documentNumber: r.document_number } : {}),
    status: r.status,
    timezone: r.timezone,
    defaultCurrency: r.default_currency,
  };
}

export function createLocalCompany(name: string, documentNumber?: string | undefined): Company {
  const db = getLocalDb();
  const id = randomUUID();
  const orgId = randomUUID();
  const legalId = randomUUID();
  db.prepare(`
    INSERT INTO companies (id, organization_id, legal_entity_id, name, document_number, status)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE')
  `).run(id, orgId, legalId, name, documentNumber ?? null);

  return {
    id,
    organizationId: orgId,
    legalEntityId: legalId,
    name,
    ...(documentNumber ? { documentNumber } : {}),
    status: "ACTIVE",
    timezone: "America/Sao_Paulo",
    defaultCurrency: "BRL",
  };
}

export function deleteLocalCompany(id: string): void {
  const db = getLocalDb();
  db.prepare(`UPDATE companies SET status = 'INACTIVE' WHERE id = ?`).run(id);
}

export function listLocalCompanyAccounts(companyId: string): {
  bankAccounts: LocalBankAccount[];
  ledgerAccounts: LocalLedgerAccount[];
  mappings: LocalAccountMapping[];
} {
  const db = getLocalDb();
  const bankRows = db.prepare(`
    SELECT * FROM bank_accounts WHERE company_id = ? AND status = 'ACTIVE' ORDER BY created_at ASC
  `).all(companyId) as Array<{
    id: string;
    company_id: string;
    bank_code: string | null;
    bank_name: string | null;
    agency: string | null;
    account_number: string | null;
    account_digit: string | null;
    account_type: string;
    currency: string;
    status: string;
    created_at: string;
  }>;

  const bankAccounts: LocalBankAccount[] = bankRows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    bankCode: r.bank_code,
    bankName: r.bank_name,
    agency: r.agency,
    accountNumber: r.account_number,
    accountDigit: r.account_digit,
    accountType: r.account_type,
    currency: r.currency,
    status: r.status,
    createdAt: r.created_at,
  }));

  const ledgerRows = db.prepare(`
    SELECT * FROM ledger_accounts WHERE company_id = ? AND status = 'ACTIVE' ORDER BY code ASC
  `).all(companyId) as Array<{
    id: string;
    company_id: string;
    code: string;
    description: string;
    source_system: string;
    status: string;
    created_at: string;
  }>;

  const ledgerAccounts: LocalLedgerAccount[] = ledgerRows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    code: r.code,
    description: r.description,
    sourceSystem: r.source_system,
    status: r.status,
    createdAt: r.created_at,
  }));

  const mappingRows = db.prepare(`
    SELECT * FROM bank_ledger_mappings WHERE company_id = ? AND status = 'ACTIVE' ORDER BY created_at ASC
  `).all(companyId) as Array<{
    id: string;
    company_id: string;
    bank_account_id: string;
    ledger_account_id: string;
    status: string;
  }>;

  const mappings: LocalAccountMapping[] = [];
  for (const m of mappingRows) {
    const bank = bankAccounts.find((b) => b.id === m.bank_account_id);
    const ledger = ledgerAccounts.find((l) => l.id === m.ledger_account_id);
    if (bank && ledger) {
      mappings.push({
        id: m.id,
        companyId: m.company_id,
        status: m.status,
        bankAccount: bank,
        ledgerAccount: ledger,
      });
    }
  }

  return { bankAccounts, ledgerAccounts, mappings };
}

export function createLocalLedgerAccount(companyId: string, code: string, description?: string | undefined): LocalLedgerAccount {
  const db = getLocalDb();
  const id = randomUUID();
  const desc = description?.trim() || `Conta ${code}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO ledger_accounts (id, company_id, code, description, source_system, status, created_at)
    VALUES (?, ?, ?, ?, 'PROTHEUS', 'ACTIVE', ?)
    ON CONFLICT(company_id, code) DO UPDATE SET
      description = excluded.description,
      status = 'ACTIVE'
  `).run(id, companyId, code, desc, now);

  return {
    id,
    companyId,
    code,
    description: desc,
    sourceSystem: "PROTHEUS",
    status: "ACTIVE",
    createdAt: now,
  };
}

export function createLocalBankAccount(
  companyId: string,
  params: {
    bankCode?: string | null | undefined;
    bankName?: string | null | undefined;
    agency?: string | null | undefined;
    accountNumber?: string | null | undefined;
    accountDigit?: string | null | undefined;
    accountType?: string | undefined;
  },
): LocalBankAccount {
  const db = getLocalDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO bank_accounts (id, company_id, bank_code, bank_name, agency, account_number, account_digit, account_type, currency, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'BRL', 'ACTIVE', ?)
  `).run(
    id,
    companyId,
    params.bankCode ?? null,
    params.bankName ?? null,
    params.agency ?? null,
    params.accountNumber ?? null,
    params.accountDigit ?? null,
    params.accountType || "CHECKING",
    now,
  );

  return {
    id,
    companyId,
    bankCode: params.bankCode ?? null,
    bankName: params.bankName ?? null,
    agency: params.agency ?? null,
    accountNumber: params.accountNumber ?? null,
    accountDigit: params.accountDigit ?? null,
    accountType: params.accountType || "CHECKING",
    currency: "BRL",
    status: "ACTIVE",
    createdAt: now,
  };
}

export function createLocalBankLedgerMapping(companyId: string, bankAccountId: string, ledgerAccountId: string): LocalAccountMapping {
  const db = getLocalDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO bank_ledger_mappings (id, company_id, bank_account_id, ledger_account_id, status, created_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', ?)
    ON CONFLICT(bank_account_id, ledger_account_id) DO UPDATE SET status = 'ACTIVE'
  `).run(id, companyId, bankAccountId, ledgerAccountId, now);

  const { bankAccounts, ledgerAccounts } = listLocalCompanyAccounts(companyId);
  const bank = bankAccounts.find((b) => b.id === bankAccountId)!;
  const ledger = ledgerAccounts.find((l) => l.id === ledgerAccountId)!;

  return {
    id,
    companyId,
    status: "ACTIVE",
    bankAccount: bank,
    ledgerAccount: ledger,
  };
}

export function deleteLocalAccount(id: string, type: "BANK" | "LEDGER" | "MAPPING", companyId: string): void {
  const db = getLocalDb();
  if (type === "MAPPING") {
    db.prepare(`DELETE FROM bank_ledger_mappings WHERE id = ? AND company_id = ?`).run(id, companyId);
  } else if (type === "BANK") {
    db.prepare(`DELETE FROM bank_ledger_mappings WHERE bank_account_id = ? AND company_id = ?`).run(id, companyId);
    db.prepare(`DELETE FROM bank_accounts WHERE id = ? AND company_id = ?`).run(id, companyId);
  } else if (type === "LEDGER") {
    db.prepare(`DELETE FROM bank_ledger_mappings WHERE ledger_account_id = ? AND company_id = ?`).run(id, companyId);
    db.prepare(`DELETE FROM ledger_accounts WHERE id = ? AND company_id = ?`).run(id, companyId);
  }
}

export function getLocalRegisteredAccountMappings(companyId: string): RegisteredAccountMapping[] {
  const { mappings } = listLocalCompanyAccounts(companyId);
  return mappings.map((m) => ({
    ...(m.bankAccount.bankCode || m.bankAccount.bankName
      ? { bank: m.bankAccount.bankCode ?? m.bankAccount.bankName! }
      : {}),
    ...(m.bankAccount.agency ? { agency: m.bankAccount.agency } : {}),
    ...(m.bankAccount.accountNumber
      ? { account: `${m.bankAccount.accountNumber}${m.bankAccount.accountDigit ? `-${m.bankAccount.accountDigit}` : ""}` }
      : {}),
    ledgerAccount: m.ledgerAccount.code,
  }));
}
