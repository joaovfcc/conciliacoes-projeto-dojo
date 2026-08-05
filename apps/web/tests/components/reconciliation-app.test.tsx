import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReconciliationApp } from "../../src/components/reconciliation-app";

describe("ReconciliationApp", () => {
  it("explica a retenção temporária antes de iniciar", () => {
    render(<ReconciliationApp />);
    expect(screen.getByText("Seus documentos são temporários")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar nova conciliação" })).toBeDisabled();
  });
});
