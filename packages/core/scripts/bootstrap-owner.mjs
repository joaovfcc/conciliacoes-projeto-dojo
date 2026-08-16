import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const organizationId = required("BOOTSTRAP_ORGANIZATION_ID");
  const organizationName = required("BOOTSTRAP_ORGANIZATION_NAME");
  const email = required("BOOTSTRAP_OWNER_EMAIL").trim().toLowerCase();
  const password = required("BOOTSTRAP_OWNER_PASSWORD");
  if (password.length < 12 || password.length > 128) throw new Error("BOOTSTRAP_OWNER_PASSWORD deve ter entre 12 e 128 caracteres");

  await prisma.$transaction(async (tx) => {
    const existingOwner = await tx.organizationMembership.findFirst({ where: { role: "OWNER" } });
    if (existingOwner) throw new Error("Bootstrap recusado: já existe um OWNER");
    await tx.configOrganization.create({
      data: {
        id: organizationId,
        name: organizationName,
        timezone: process.env.BOOTSTRAP_ORGANIZATION_TIMEZONE || "America/Sao_Paulo",
        defaultCurrency: process.env.BOOTSTRAP_ORGANIZATION_CURRENCY || "BRL",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const user = await tx.user.create({
      data: {
        id: randomUUID(),
        email,
        passwordHash: await hash(password),
        passwordChangeRequired: true,
      },
    });
    await tx.organizationMembership.create({
      data: { organizationId, userId: user.id, role: "OWNER" },
    });
  }, { isolationLevel: "Serializable" });
  console.info("OWNER inicial criado com sucesso");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha no bootstrap do OWNER");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} é obrigatório`);
  return value;
}
