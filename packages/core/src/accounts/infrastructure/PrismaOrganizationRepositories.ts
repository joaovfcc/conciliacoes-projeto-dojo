import type { PrismaClient } from "@prisma/client";
import type { Company } from "../../companies/domain/Company.js";
import type { CompanyRepository } from "../../companies/domain/CompanyRepository.js";
import type { BankAccountRepository, LedgerAccountRepository } from "../domain/AccountRepositories.js";
import type { BankAccount } from "../domain/BankAccount.js";
import type { LedgerAccount } from "../domain/LedgerAccount.js";

export class PrismaCompanyRepository implements CompanyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(company: Company): Promise<void> {
    await this.prisma.company.upsert({
      where: { id: company.id },
      update: company,
      create: company,
    });
  }

  async findById(id: string): Promise<Company | null> {
    const record = await this.prisma.company.findUnique({ where: { id } });
    return record ? this.map(record) : null;
  }

  async listActive(): Promise<Company[]> {
    const records = await this.prisma.company.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
    return records.map((record) => this.map(record));
  }

  private map(record: {
    id: string;
    organizationId: string;
    legalEntityId: string;
    name: string;
    documentNumber: string | null;
    status: "ACTIVE" | "INACTIVE";
    timezone: string;
    defaultCurrency: string;
  }): Company {
    return {
      id: record.id,
      organizationId: record.organizationId,
      legalEntityId: record.legalEntityId,
      name: record.name,
      ...(record.documentNumber ? { documentNumber: record.documentNumber } : {}),
      status: record.status,
      timezone: record.timezone,
      defaultCurrency: record.defaultCurrency,
    };
  }
}

export class PrismaBankAccountRepository implements BankAccountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(account: BankAccount): Promise<void> {
    await this.prisma.bankAccount.upsert({
      where: { id: account.id },
      update: account,
      create: account,
    });
  }

  async findById(id: string): Promise<BankAccount | null> {
    const record = await this.prisma.bankAccount.findUnique({ where: { id } });
    return record ? this.map(record) : null;
  }

  async listByCompany(companyId: string): Promise<BankAccount[]> {
    const records = await this.prisma.bankAccount.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } });
    return records.map((record) => this.map(record));
  }

  private map(record: {
    id: string;
    companyId: string;
    bankCode: string | null;
    bankName: string | null;
    agency: string | null;
    accountNumber: string | null;
    accountDigit: string | null;
    accountType: "CHECKING" | "SAVINGS" | "INVESTMENT" | "OTHER";
    currency: string;
    status: "ACTIVE" | "INACTIVE";
  }): BankAccount {
    return {
      id: record.id,
      companyId: record.companyId,
      ...(record.bankCode ? { bankCode: record.bankCode } : {}),
      ...(record.bankName ? { bankName: record.bankName } : {}),
      ...(record.agency ? { agency: record.agency } : {}),
      ...(record.accountNumber ? { accountNumber: record.accountNumber } : {}),
      ...(record.accountDigit ? { accountDigit: record.accountDigit } : {}),
      accountType: record.accountType,
      currency: record.currency,
      status: record.status,
    };
  }
}

export class PrismaLedgerAccountRepository implements LedgerAccountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(account: LedgerAccount): Promise<void> {
    await this.prisma.ledgerAccount.upsert({
      where: { id: account.id },
      update: account,
      create: account,
    });
  }

  async findById(id: string): Promise<LedgerAccount | null> {
    const record = await this.prisma.ledgerAccount.findUnique({ where: { id } });
    return record ? this.map(record) : null;
  }

  async listByCompany(companyId: string): Promise<LedgerAccount[]> {
    const records = await this.prisma.ledgerAccount.findMany({ where: { companyId }, orderBy: { code: "asc" } });
    return records.map((record) => this.map(record));
  }

  private map(record: {
    id: string;
    companyId: string;
    code: string;
    description: string;
    sourceSystem: string;
    status: "ACTIVE" | "INACTIVE";
  }): LedgerAccount {
    return {
      id: record.id,
      companyId: record.companyId,
      code: record.code,
      description: record.description,
      sourceSystem: record.sourceSystem === "PROTHEUS" ? "PROTHEUS" : "OTHER",
      status: record.status,
    };
  }
}
