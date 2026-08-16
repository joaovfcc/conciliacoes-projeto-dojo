export interface Company {
  id: string;
  organizationId: string;
  legalEntityId: string;
  name: string;
  documentNumber?: string;
  status: "ACTIVE" | "INACTIVE";
  timezone: string;
  defaultCurrency: string;
}
