import type { StatementLayoutProfile } from "../../statements/statement-types.js";
import type { LayoutFingerprint } from "../../layouts/domain/LayoutModels.js";

export interface SaveLayoutOptions {
  approvedBy?: string;
  approvedAt?: Date;
  fingerprint?: LayoutFingerprint;
  bankAccountId?: string;
  priority?: number;
}

export interface LayoutRepository {
  save(profile: StatementLayoutProfile, options?: SaveLayoutOptions): Promise<void>;
  findAll(): Promise<StatementLayoutProfile[]>;
  findActiveForAccount?(bankAccountId: string): Promise<StatementLayoutProfile[]>;
  findById(id: string): Promise<StatementLayoutProfile | null>;
}
