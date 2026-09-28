import type { NextRequest } from "next/server";
import { listLocalCompanies } from "@/lib/local-store";

export async function GET(request: NextRequest) {
  if (process.env.LOCAL_MODE === "true" || !process.env.DATABASE_URL) {
    const companies = listLocalCompanies().map((c) => ({
      id: c.id,
      organizationId: c.organizationId,
      name: c.name,
      roles: ["ADMIN", "PREPARER", "REVIEWER", "AUDITOR"] as Array<"ADMIN" | "PREPARER" | "REVIEWER" | "AUDITOR">,
    }));
    return Response.json(
      {
        id: "usr_local_admin",
        email: "analista@local",
        passwordChangeRequired: false,
        ownerOrganizationIds: ["org-default-001"],
        companyRoles: Object.fromEntries(
          companies.map((c) => [c.id, ["ADMIN", "PREPARER", "REVIEWER", "AUDITOR"]]),
        ),
        companies,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const { authHandlers } = await import("@/lib/auth-runtime");
  return authHandlers().me(request);
}
