import type { NextRequest } from "next/server";
import {
  getReconciliationHistory,
  deleteReconciliationHistory,
  reconciliationHistoryError,
} from "@/lib/reconciliation-history-api";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    return await getReconciliationHistory(request, (await context.params).id);
  } catch (error) {
    return reconciliationHistoryError(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    return await deleteReconciliationHistory(request, (await context.params).id);
  } catch (error) {
    return reconciliationHistoryError(error);
  }
}
