import type { NextRequest } from "next/server";
import { listReconciliationHistory, reconciliationHistoryError } from "@/lib/reconciliation-history-api";

export async function GET(request: NextRequest) {
  try {
    return await listReconciliationHistory(request);
  } catch (error) {
    return reconciliationHistoryError(error);
  }
}
