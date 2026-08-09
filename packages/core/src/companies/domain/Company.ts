export interface Company {
  id: string;
  name: string;
  documentNumber?: string;
  status: "ACTIVE" | "INACTIVE";
  timezone: string;
  defaultCurrency: string;
}
