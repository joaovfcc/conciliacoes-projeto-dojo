export interface BankAccount {
  id: string;
  companyId: string;
  bankCode?: string;
  bankName?: string;
  agency?: string;
  accountNumber?: string;
  accountDigit?: string;
  accountType: "CHECKING" | "SAVINGS" | "INVESTMENT" | "OTHER";
  currency: string;
  status: "ACTIVE" | "INACTIVE";
}
