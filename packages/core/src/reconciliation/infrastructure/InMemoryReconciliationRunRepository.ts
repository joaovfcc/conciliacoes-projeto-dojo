import type { ReconciliationRunRepository } from "../domain/ReconciliationRunRepository.js";
import type { ReconciliationRun } from "../domain/ReconciliationRun.js";

const copyRun = (run: ReconciliationRun): ReconciliationRun => structuredClone(run);

export class InMemoryReconciliationRunRepository implements ReconciliationRunRepository {
  readonly runs = new Map<string, ReconciliationRun>();

  async save(run: ReconciliationRun): Promise<void> {
    this.runs.set(run.id, copyRun(run));
  }

  async findById(id: string): Promise<ReconciliationRun | null> {
    const run = this.runs.get(id);
    return run ? copyRun(run) : null;
  }

  async findByCompanyId(companyId: string): Promise<ReconciliationRun[]> {
    return [...this.runs.values()]
      .filter((run) => run.companyId === companyId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map(copyRun);
  }
}
