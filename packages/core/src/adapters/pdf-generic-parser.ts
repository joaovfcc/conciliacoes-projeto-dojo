import { parseMoney, money, parseDate } from "../normalization.js";
import type { StatementSourceAdapter, ExtractedStatementSource, CanonicalStatementDocument, StatementSourceDetection, CanonicalBankTransaction, StatementSourceValidation } from "../statement-sources.js";
import { createSourceProvenance } from "../statement-sources.js";
import type { PdfLayoutProfile } from "./pdf-profile.js";

function normalizeAscii(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function splitLines(text: string, sanitizer?: (line: string) => string): string[] {
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    return sanitizer ? sanitizer(trimmed) : trimmed;
  });
}

export function createPdfAdapterFromProfile(profile: PdfLayoutProfile): StatementSourceAdapter<"PDF"> {
  return {
    adapterId: profile.adapterId,
    adapterVersion: profile.adapterVersion,
    format: "PDF",
    institutionCode: profile.institutionCode,
    documentType: profile.documentType,
    layoutFamily: profile.layoutFamily,

    detect(source: ExtractedStatementSource & { format: "PDF" }): StatementSourceDetection {
      const allText = (source.pages ?? []).map((p) => p.text).join("\n");
      const upper = normalizeAscii(allText).toUpperCase();
      const positiveMatches = profile.detection.positiveSignatures.filter((sig) => upper.includes(sig));
      const negativeMatches = profile.detection.negativeSignatures.filter((sig) => upper.includes(sig));
      const matched = positiveMatches.length === profile.detection.positiveSignatures.length && negativeMatches.length === 0;
      return {
        matched,
        score: matched ? 100 : positiveMatches.length * 20,
        evidenceCodes: positiveMatches.map((sig) => `SIGNATURE:${sig}`),
      };
    },

    parse(source: ExtractedStatementSource & { format: "PDF" }): CanonicalStatementDocument {
      const pages = source.pages ?? [];
      const allText = pages.map((p) => p.text).join("\n");
      const upperAllText = normalizeAscii(allText).toUpperCase();

      // Extract Identity
      const identityMatch = profile.identity.regex.exec(upperAllText);
      const agency = profile.identity.agencyGroup && identityMatch?.[profile.identity.agencyGroup]
        ? identityMatch[profile.identity.agencyGroup]!.replace(/\D/g, "")
        : "";
      const account = profile.identity.accountGroup && identityMatch?.[profile.identity.accountGroup]
        ? identityMatch[profile.identity.accountGroup]!.replace(/\D/g, "")
        : "";

      const transactions: CanonicalBankTransaction[] = [];
      let txIndex = 0;
      let currentDate = "";
      
      const year = profile.transactions.inferYear ? profile.transactions.inferYear(allText) : String(new Date().getUTCFullYear());

      let current: { date: string; document: string; history: string[]; value: string; runningBalance: string; line: number } | undefined;
      const issues: Array<{ severity: "WARNING" | "ERROR"; code: string; message: string; sourcePosition?: string }> = [];

      const flush = (pageInfo: { method: "TEXT" | "OCR", page: number, sourceId: string, sha256: string }) => {
        if (!current) return;
        txIndex++;
        const rawAmount = current.value;
        const amount = parseMoney(rawAmount);

        let finalHistory = current.history.join(" ").trim();
        let finalDocument = current.document;

        if (profile.transactions.extractDocumentFromHistory && !finalDocument) {
           const bodyParts = finalHistory.split(/\s+/);
           const possibleDoc = bodyParts.at(-1) ?? "";
           if (/^\d{4,10}$/.test(possibleDoc)) {
              finalDocument = bodyParts.pop()!;
              finalHistory = bodyParts.join(" ");
           }
        }

        transactions.push({
          transactionId: `tx-${txIndex}`,
          postingDate: parseDate(current.date),
          amount: money(amount),
          direction: amount.isNegative() ? "DEBIT" : "CREDIT",
          description: finalHistory,
          documentNumber: finalDocument,
          ...(current.runningBalance ? { runningBalance: money(parseMoney(current.runningBalance)) } : {}),
          provenance: createSourceProvenance({
            sourceId: pageInfo.sourceId,
            format: "PDF",
            adapterId: profile.adapterId,
            adapterVersion: profile.adapterVersion,
            rawHash: pageInfo.sha256,
            extractionMethod: pageInfo.method,
            page: pageInfo.page,
          }),
        });
        current = undefined;
      };

      for (const page of pages) {
        const lines = splitLines(page.text, profile.transactions.lineSanitizer);
        const headerIdx = profile.transactions.headerBoundaryRegex 
          ? lines.findIndex((line) => profile.transactions.headerBoundaryRegex!.test(normalizeAscii(line)))
          : -1;

        for (const [lineIndex, line] of lines.entries()) {
          if (headerIdx >= 0 && lineIndex <= headerIdx) continue;
          
          const normalizedLine = normalizeAscii(line);
          
          if (profile.transactions.stopRegex && profile.transactions.stopRegex.test(normalizedLine)) {
            flush({ method: page.method === "OCR" ? "OCR" : "TEXT", page: page.page, sourceId: source.sourceId, sha256: source.sha256 });
            break;
          }

          if (!line.trim() || (profile.transactions.ignoredRegex && profile.transactions.ignoredRegex.test(normalizedLine))) {
             continue;
          }

          const match = profile.transactions.pattern.exec(line);
          if (match) {
            flush({ method: page.method === "OCR" ? "OCR" : "TEXT", page: page.page, sourceId: source.sourceId, sha256: source.sha256 });
            
            const rawDate = match[profile.transactions.dateGroup] || currentDate;
            currentDate = rawDate;
            if (!currentDate) continue;

            let date = rawDate.length === 5 ? `${rawDate}/${year}` : rawDate;
            if (profile.transactions.dateTransform) {
              date = profile.transactions.dateTransform(date);
            }
            
            let rawAmount = match[profile.transactions.valueGroup] || "";
            if (profile.transactions.negativeSignGroup && match[profile.transactions.negativeSignGroup]) {
              const sign = match[profile.transactions.negativeSignGroup]!.trim();
              if (sign === "-" || sign.toUpperCase() === "D") {
                 rawAmount = "-" + rawAmount.replace(/^-/, "");
              }
            }

            const historyText = profile.transactions.historyGroup && match[profile.transactions.historyGroup] 
               ? match[profile.transactions.historyGroup]!.trim() 
               : "";
            
            const doc = profile.transactions.documentGroup && match[profile.transactions.documentGroup]
               ? match[profile.transactions.documentGroup]!.trim()
               : "";
               
            const balance = profile.transactions.runningBalanceGroup && match[profile.transactions.runningBalanceGroup]
               ? match[profile.transactions.runningBalanceGroup]!.trim()
               : "";

            current = {
               date,
               document: doc,
               history: historyText ? [historyText] : [],
               value: rawAmount,
               runningBalance: balance,
               line: lineIndex + 1
            };
          } else if (current && profile.transactions.multiLineHistory && /^[A-Z0-9]/.test(normalizedLine)) {
            current.history.push(line.trim());
          } else if (/^\d{2}\/\d{2}\b/.test(line) && profile.institutionCode === "341") {
            // Specific warning for Itaú incomplete OCR lines
            issues.push({
              severity: "WARNING",
              code: "OCR_LINHA_INCOMPLETA",
              message: "Uma linha do extrato não foi usada porque o OCR não identificou um valor monetário completo.",
              sourcePosition: `página ${page.page}, linha ${lineIndex + 1}`
            });
          }
        }
        flush({ method: page.method === "OCR" ? "OCR" : "TEXT", page: page.page, sourceId: source.sourceId, sha256: source.sha256 });
      }

      // Detect explicit no-movements
      const declaresNoMovements =
        upperAllText.includes("SEM MOVIMENT") ||
        upperAllText.includes("NAO HOUVE LANC") ||
        upperAllText.includes("SEM TRANSAC");

      // Compute balances from running balance
      const openingBalance = transactions.length && transactions[0]!.runningBalance
        ? money(parseMoney(transactions[0]!.runningBalance!).minus(parseMoney(transactions[0]!.amount)))
        : undefined;
        
      const closingBalance = transactions.length && transactions.at(-1)!.runningBalance
        ? transactions.at(-1)!.runningBalance
        : undefined;

      // Extract periods
      const txDates = transactions.map((tx) => tx.postingDate);
      const startDate = txDates.length ? txDates.sort()[0]! : undefined;
      const endDate = txDates.length ? txDates.sort().at(-1)! : undefined;

      let bankName = "";
      if (profile.institutionCode === "237") bankName = "BRADESCO";
      if (profile.institutionCode === "341") bankName = "ITAU";
      if (profile.institutionCode === "033") bankName = "SANTANDER";
      if (profile.institutionCode === "070") bankName = "BRB";
      if (profile.institutionCode === "633") bankName = "SOFISA";

      return {
        sourceId: source.sourceId,
        format: "PDF",
        institutionCode: profile.institutionCode,
        documentType: profile.documentType,
        layoutFamily: profile.layoutFamily,
        adapterId: profile.adapterId,
        adapterVersion: profile.adapterVersion,
        identity: {
          bankCode: profile.institutionCode,
          bankName: bankName || "",
          ...(agency ? { agency: { raw: agency, normalized: agency } } : {}),
          ...(account ? { account: { raw: account, normalized: account } } : {}),
        },
        ...(startDate && endDate ? { period: { start: startDate, end: endDate } } : {}),
        transactions,
        ...(declaresNoMovements && transactions.length === 0 ? { declaresNoMovements: true } : {}),
        ...(openingBalance !== undefined ? { openingBalance } : {}),
        ...(closingBalance !== undefined ? { closingBalance } : {}),
        issues,
      };
    },

    validate(document: CanonicalStatementDocument): StatementSourceValidation {
      const issues = [...document.issues]; // Include parsing warnings

      if (!document.identity.bankName) {
        issues.push({ severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Identidade bancária não detectada." });
      }
      if (document.transactions.length === 0 && !document.declaresNoMovements) {
        issues.push({ severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhum movimento foi extraído do extrato." });
      }

      return { accepted: issues.every((i) => i.severity !== "ERROR"), issues };
    },
  };
}
