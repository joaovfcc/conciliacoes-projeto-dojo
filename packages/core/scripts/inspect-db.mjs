import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const envPath = resolve(process.cwd(), "../../.env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    include: {
      organizationMemberships: true,
      companyAccesses: {
        include: { company: true },
      },
    },
  });
  const orgs = await prisma.configOrganization.findMany();
  const companies = await prisma.company.findMany();

  console.log("Users:", JSON.stringify(users, null, 2));
  console.log("Organizations:", JSON.stringify(orgs, null, 2));
  console.log("Companies:", JSON.stringify(companies, null, 2));
}

main().finally(() => prisma.$disconnect());
