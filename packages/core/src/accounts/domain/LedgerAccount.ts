export interface LedgerAccount {
  id: string;
  companyId: string;
  code: string;
  description: string;
  sourceSystem: "PROTHEUS" | "OTHER";
  status: "ACTIVE" | "INACTIVE";
}
