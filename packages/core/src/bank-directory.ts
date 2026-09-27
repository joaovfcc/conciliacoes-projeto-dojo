export type BankCatalogAvailability = "OBSERVED_IN_CORPUS" | "AWAITING_SAMPLE";

export type BankInstitution = {
  institutionId: string;
  canonicalName: string;
  bankCode?: string;
  aliases: readonly string[];
  availability: BankCatalogAvailability;
};

export type BankInstitutionCatalogSummary = {
  total: number;
  observedInCorpus: number;
  awaitingSample: number;
};

/**
 * Identity catalog only. An entry recognizes bank metadata but never implies
 * that an adapter, balance control, or accounting oracle is available.
 */
export const BANK_INSTITUTION_CATALOG: readonly BankInstitution[] = [
  bank("ABC_BRASIL", "ABC_BRASIL", "246", ["abc brasil", "banco abc brasil", "246"], "OBSERVED_IN_CORPUS"),
  bank("BANCO_DO_BRASIL", "BANCO_DO_BRASIL", "001", ["banco do brasil", "bb", "001"], "OBSERVED_IN_CORPUS"),
  bank("BMG", "BMG", "318", ["bmg", "banco bmg", "318"], "OBSERVED_IN_CORPUS"),
  bank("BMP", "BMP", "274", ["bmp", "banco bmp", "274"], "OBSERVED_IN_CORPUS"),
  bank("BOCOM", "BOCOM", "107", ["bocom", "bocom bbm", "banco bocom", "107"], "OBSERVED_IN_CORPUS"),
  bank("BRADESCO", "BRADESCO", "237", ["bradesco", "banco bradesco", "237"], "OBSERVED_IN_CORPUS"),
  bank("BRB", "BRB", "070", ["brb", "banco de brasilia", "070"], "OBSERVED_IN_CORPUS"),
  bank("CAIXA", "CAIXA", "104", ["caixa", "caixa economica", "cef", "104"], "OBSERVED_IN_CORPUS"),
  bank("DAYCOVAL", "DAYCOVAL", "707", ["daycoval", "banco daycoval", "707"], "OBSERVED_IN_CORPUS"),
  bank("GUANABARA", "GUANABARA", "612", ["guanabara", "banco guanabara", "612"], "OBSERVED_IN_CORPUS"),
  bank("ITAU", "ITAU", "341", ["itau", "itau unibanco", "unibanco", "341"], "OBSERVED_IN_CORPUS"),
  bank("PAULISTA", "PAULISTA", undefined, ["paulista", "banco paulista"], "OBSERVED_IN_CORPUS"),
  bank("PINE", "PINE", undefined, ["pine", "banco pine"], "OBSERVED_IN_CORPUS"),
  bank("PLANNER", "PLANNER", undefined, ["planner", "planner corretora"], "OBSERVED_IN_CORPUS"),
  bank("SAFRA", "SAFRA", "422", ["safra", "banco safra", "422"], "OBSERVED_IN_CORPUS"),
  bank("SANTANDER", "SANTANDER", "033", ["santander", "banco santander", "033"], "OBSERVED_IN_CORPUS"),
  bank("SOFISA", "SOFISA", "633", ["sofisa", "banco sofisa", "633", "637"], "OBSERVED_IN_CORPUS"),
  bank("VORTX", "VORTX", undefined, ["vortx", "vortx digital"], "OBSERVED_IN_CORPUS"),

  // Capacity slots for institutions requested outside the current private corpus.
  bank("INTER", "INTER", "077", ["inter", "banco inter", "077"], "AWAITING_SAMPLE"),
  bank("NUBANK", "NUBANK", "260", ["nubank", "nu pagamentos", "260"], "AWAITING_SAMPLE"),
  bank("SICREDI", "SICREDI", "748", ["sicredi", "748"], "AWAITING_SAMPLE"),
  bank("SICOOB", "SICOOB", "756", ["sicoob", "756"], "AWAITING_SAMPLE"),
  bank("BTG_PACTUAL", "BTG_PACTUAL", "208", ["btg pactual", "btg", "208"], "AWAITING_SAMPLE"),
];

export function resolveBankInstitution(value: string | undefined): BankInstitution | undefined {
  const normalized = normalizeBankText(value);
  if (!normalized) return undefined;
  return BANK_INSTITUTION_CATALOG.find((entry) => entry.aliases.some((alias) => hasWholeAlias(normalized, alias)));
}

export function summarizeBankInstitutionCatalog(
  entries: readonly BankInstitution[],
): BankInstitutionCatalogSummary {
  return {
    total: entries.length,
    observedInCorpus: entries.filter((entry) => entry.availability === "OBSERVED_IN_CORPUS").length,
    awaitingSample: entries.filter((entry) => entry.availability === "AWAITING_SAMPLE").length,
  };
}

function bank(
  institutionId: string,
  canonicalName: string,
  bankCode: string | undefined,
  aliases: readonly string[],
  availability: BankCatalogAvailability,
): BankInstitution {
  return {
    institutionId,
    canonicalName,
    ...(bankCode ? { bankCode } : {}),
    aliases,
    availability,
  };
}

function hasWholeAlias(text: string, alias: string): boolean {
  const normalizedAlias = normalizeBankText(alias);
  return normalizedAlias !== "" && (` ${text} `).includes(` ${normalizedAlias} `);
}

function normalizeBankText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
