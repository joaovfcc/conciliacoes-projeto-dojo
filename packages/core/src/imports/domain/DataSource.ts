export interface DataSource {
  id: string;
  companyId?: string;
  name: string;
  type: "BANK_STATEMENT" | "GENERAL_LEDGER" | "SUBLEDGER" | "ERP_REPORT" | "MANUAL_FILE";
  connectorType: "API" | "SFTP" | "DATABASE" | "FILE_UPLOAD" | "NETWORK_FOLDER";
  status: "ACTIVE" | "INACTIVE";
}
