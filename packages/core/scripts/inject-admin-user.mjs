import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";

const envPath = resolve(process.cwd(), "../../.env");
const fallbackEnvPath = resolve(process.cwd(), ".env");
const targetEnv = existsSync(envPath) ? envPath : existsSync(fallbackEnvPath) ? fallbackEnvPath : null;

if (targetEnv) {
  const content = readFileSync(targetEnv, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

const prisma = new PrismaClient();

async function main() {
  const email = "vitorfchaves1@gmail.com".toLowerCase().trim();
  const password = "36016838Jo@0";

  console.info(`Injetando usuário administrador: ${email}...`);

  const passwordHash = await hash(password);

  await prisma.$transaction(async (tx) => {
    // 1. Garantir que exista uma organização ativa
    let org = await tx.configOrganization.findFirst({ where: { status: "ACTIVE" } });
    if (!org) {
      org = await tx.configOrganization.create({
        data: {
          id: "org-default-001",
          name: "Organização Matriz",
          timezone: "America/Sao_Paulo",
          defaultCurrency: "BRL",
          status: "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      console.info(`Organização criada: ${org.name} (${org.id})`);
    }

    // 2. Criar ou atualizar o usuário
    let user = await tx.user.findUnique({ where: { email } });
    if (!user) {
      user = await tx.user.create({
        data: {
          id: randomUUID(),
          email,
          passwordHash,
          passwordChangeRequired: false,
        },
      });
      console.info(`Usuário criado com ID: ${user.id}`);
    } else {
      user = await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangeRequired: false,
        },
      });
      console.info(`Senha do usuário ${user.id} atualizada com sucesso`);
    }

    // 3. Garantir que o usuário seja OWNER da organização
    const existingMembership = await tx.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: user.id,
        },
      },
    });

    if (!existingMembership) {
      await tx.organizationMembership.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          role: "OWNER",
        },
      });
      console.info(`Membro OWNER adicionado à organização ${org.id}`);
    } else if (existingMembership.role !== "OWNER") {
      await tx.organizationMembership.update({
        where: { id: existingMembership.id },
        data: { role: "OWNER" },
      });
      console.info(`Papel atualizado para OWNER na organização ${org.id}`);
    }
  });

  console.info("Administrador injetado e pronto para login!");
}

main()
  .catch((err) => {
    console.error("Falha ao injetar administrador:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
