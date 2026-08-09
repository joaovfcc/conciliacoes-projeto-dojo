import type { BankAccount } from "./BankAccount.js";
import type { LedgerAccount } from "./LedgerAccount.js";

export interface BankAccountRepository {
  save(account: BankAccount): Promise<void>;
  findById(id: string): Promise<BankAccount | null>;
  listByCompany(companyId: string): Promise<BankAccount[]>;
}

export interface LedgerAccountRepository {
  save(account: LedgerAccount): Promise<void>;
  findById(id: string): Promise<LedgerAccount | null>;
  listByCompany(companyId: string): Promise<LedgerAccount[]>;
}
