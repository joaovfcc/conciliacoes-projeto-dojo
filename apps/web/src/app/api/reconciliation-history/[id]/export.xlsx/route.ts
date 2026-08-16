import type { NextRequest } from "next/server";
import { exportReconciliationHistory, reconciliationHistoryError } from "@/lib/reconciliation-history-api";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    return await exportReconciliationHistory(request, (await context.params).id);
  } catch (error) {
    return reconciliationHistoryError(error);
  }
}
