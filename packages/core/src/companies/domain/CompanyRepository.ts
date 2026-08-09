import type { Company } from "./Company.js";

export interface CompanyRepository {
  save(company: Company): Promise<void>;
  findById(id: string): Promise<Company | null>;
  listActive(): Promise<Company[]>;
}
