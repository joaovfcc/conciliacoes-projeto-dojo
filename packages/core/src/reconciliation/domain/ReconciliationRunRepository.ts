import type { ReconciliationRun } from "./ReconciliationRun.js";

export interface ReconciliationRunRepository {
  save(run: ReconciliationRun): Promise<void>;
  findById(id: string): Promise<ReconciliationRun | null>;
  findByCompanyId(companyId: string): Promise<ReconciliationRun[]>;
}
