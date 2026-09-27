import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://localhost:3000";
const ORIGIN = "http://localhost:3000";

async function main() {
  console.log("=== Iniciando Teste de Conciliação com Arquivos Reais ===");

  // 1. Login
  console.log("1. Autenticando com usuário administrador...");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email: "vitorfchaves1@gmail.com", password: "36016838Jo@0" }),
  });
  if (!loginRes.ok) {
    throw new Error(`Falha no login: HTTP ${loginRes.status} - ${await loginRes.text()}`);
  }
  const loginData = await loginRes.json();
  const accessToken = loginData.accessToken;
  console.log("   Autenticado com sucesso! Usuário:", loginData.user?.email);

  // 2. Obter empresas
  console.log("2. Obtendo lista de empresas operacionais...");
  const compRes = await fetch(`${BASE_URL}/api/companies`, {
    headers: { Authorization: `Bearer ${accessToken}`, Origin: ORIGIN },
  });
  const compData = await compRes.json();
  const company = compData.companies?.[0];
  if (!company) throw new Error("Nenhuma empresa operacional encontrada");
  console.log("   Empresa selecionada:", company.name, `(${company.id})`);

  // 3. Criar sessão de conciliação
  console.log("3. Criando sessão de conciliação...");
  const sessionRes = await fetch(`${BASE_URL}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, Origin: ORIGIN },
    body: JSON.stringify({ companyId: company.id }),
  });
  if (!sessionRes.ok) throw new Error(`Falha ao criar sessão: ${sessionRes.status} - ${await sessionRes.text()}`);
  const { session, token: sessionToken } = await sessionRes.json();
  console.log("   Sessão criada:", session.id);

  const sessionHeaders = {
    "X-Reconciliation-Session-Token": sessionToken,
    Authorization: `Bearer ${accessToken}`,
    Origin: ORIGIN,
  };

  // 4. Upload dos arquivos
  const ledgerPath = fs.existsSync("C:/Users/joao.carvalho/Documents/TESTES/1225_11102027.xlsx")
    ? "C:/Users/joao.carvalho/Documents/TESTES/1225_11102027.xlsx"
    : "C:/Users/joao.carvalho/Documents/TESTES/ITAU/11102027.xlsx";
  const statementPath = "C:/Users/joao.carvalho/Documents/TESTES/ITAU/Itau_1_dados_limpos.xlsx";

  console.log("4. Fazendo upload dos arquivos:");
  console.log("   Razão:", ledgerPath);
  console.log("   Extrato:", statementPath);

  await uploadFile(session.id, sessionHeaders, ledgerPath, "LEDGER");
  await uploadFile(session.id, sessionHeaders, statementPath, "STATEMENT");

  // 5. Preflight (Pré-análise)
  console.log("5. Solicitando pré-análise (Preflight)...");
  const preflightRes = await fetch(`${BASE_URL}/api/sessions/${session.id}/preflight`, {
    method: "POST",
    headers: sessionHeaders,
  });
  if (!preflightRes.ok) throw new Error(`Falha no preflight: ${preflightRes.status} - ${await preflightRes.text()}`);

  let preflight = null;
  for (let i = 0; i < 30; i++) {
    const statusRes = await fetch(`${BASE_URL}/api/sessions/${session.id}/status`, { headers: sessionHeaders });
    const { session: currentSession } = await statusRes.json();
    if (currentSession.preflight) {
      preflight = currentSession.preflight;
      break;
    }
    if (currentSession.status === "FAILED") {
      throw new Error(`Preflight falhou: ${currentSession.errorMessage}`);
    }
    console.log(`   Aguardando pré-análise... (${currentSession.status} - ${currentSession.progressMessage})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!preflight) throw new Error("Tempo limite aguardando preflight");

  console.log("\n--- RESULTADO DA PRÉ-ANÁLISE (PREFLIGHT) ---");
  console.log("   Empresas detectadas:", preflight.companies);
  console.log("   Contas contábeis no razão:", preflight.ledgerAccounts.map((a) => `${a.account} (${a.recordCount} reg, Bco ${a.bank}, Ag ${a.agency}, C/C ${a.bankAccount})`));
  console.log("   Extratos detectados:", preflight.statements.map((s) => `${s.originalName}: Banco ${s.bank}, C/C ${s.account}, Períodos ${s.periods.join(",")}, Registros: ${s.recordCount}`));
  console.log("   Períodos detectados:", preflight.detectedPeriods);
  if (preflight.issues?.length > 0) {
    console.log("   Alertas do preflight:", preflight.issues);
  }

  // 6. Confirmar e Conciliar
  console.log("\n6. Confirmando mapeamento e processando conciliação...");
  const targetPeriod = preflight.detectedPeriods[0]?.period || "202512";
  const targetLedgerAccount = preflight.ledgerAccounts[0]?.account || "11102027";
  const statementFileId = preflight.statements[0]?.fileId;

  const confirmBody = {
    company: preflight.companies[0] || "SPREAD",
    period: targetPeriod,
    valueTolerance: "0.01",
    dateToleranceDays: 2,
    mappings: [
      {
        ledgerAccount: targetLedgerAccount,
        statementFileIds: [statementFileId],
        signProfile: "BANK_LIABILITY",
      },
    ],
    idempotencyKey: crypto.randomUUID(),
  };

  const confirmRes = await fetch(`${BASE_URL}/api/sessions/${session.id}/confirm-and-process`, {
    method: "POST",
    headers: { ...sessionHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(confirmBody),
  });

  if (!confirmRes.ok) throw new Error(`Falha ao confirmar conciliação: ${confirmRes.status} - ${await confirmRes.text()}`);

  let result = null;
  for (let i = 0; i < 30; i++) {
    const statusRes = await fetch(`${BASE_URL}/api/sessions/${session.id}/status`, { headers: sessionHeaders });
    const { session: currentSession } = await statusRes.json();
    if (currentSession.result) {
      result = currentSession.result;
      break;
    }
    if (currentSession.status === "FAILED") {
      throw new Error(`Processamento falhou: ${currentSession.errorMessage}`);
    }
    console.log(`   Aguardando conciliação... (${currentSession.status} - ${currentSession.progressMessage})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!result) throw new Error("Tempo limite aguardando resultado da conciliação");

  console.log("\n================ RESULTADO DA CONCILIAÇÃO ================");
  console.log(`Empresa: ${result.company} | Competência: ${result.period}`);
  console.log(`Total de resultados: ${result.results.length}`);

  // Contagem por status
  const statusCounts = {};
  for (const item of result.results) {
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  }
  console.log("\nDistribuição por Regras / Status:");
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  - ${status}: ${count}`);
  }

  // Controles e Cobertura
  if (result.controls) {
    console.log("\nControles de Validação:");
    console.log(`  - Movimento Bancário Conciliável: R$ ${result.controls.movements.bankConciliable}`);
    console.log(`  - Movimento do Razão Contábil:    R$ ${result.controls.movements.ledger}`);
    console.log(`  - Diferença de Movimento:         R$ ${result.controls.movements.difference}`);
    console.log(`  - Status do Movimento:            ${result.controls.movements.status}`);
    console.log(`  - Cobertura de Linhas:            ${result.controls.coverage.lines.percentage}% (${result.controls.coverage.lines.covered}/${result.controls.coverage.lines.total})`);
    console.log(`  - Cobertura de Valor Absoluto:    ${result.controls.coverage.absoluteValue.percentage}%`);
  }

  // 7. Exportar relatório Excel
  console.log("\n7. Exportando relatório Excel (.xlsx)...");
  const exportRes = await fetch(`${BASE_URL}/api/sessions/${session.id}/export.xlsx`, {
    headers: sessionHeaders,
  });
  if (exportRes.ok) {
    const buffer = Buffer.from(await exportRes.arrayBuffer());
    const exportPath = `C:/Users/joao.carvalho/Documents/TESTES/ITAU/RELATORIO_CONCILIACAO_${result.period}.xlsx`;
    fs.writeFileSync(exportPath, buffer);
    console.log(`   Relatório exportado com sucesso (${buffer.length} bytes):`);
    console.log(`   -> ${exportPath}`);
  } else {
    console.log("   Aviso: Exportação retornou status", exportRes.status);
  }

  console.log("\n=== Teste Concluído com Sucesso! ===");
}

async function uploadFile(sessionId, sessionHeaders, filePath, kind) {
  const fileName = path.basename(filePath);
  const fileStat = fs.statSync(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  // Authorize upload
  const authRes = await fetch(`${BASE_URL}/api/sessions/${sessionId}/uploads/authorize`, {
    method: "POST",
    headers: { ...sessionHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      kind,
      originalName: fileName,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: fileStat.size,
    }),
  });
  if (!authRes.ok) throw new Error(`Falha ao autorizar upload de ${fileName}: ${authRes.status} - ${await authRes.text()}`);
  const authData = await authRes.json();
  const fileId = authData.file.id;
  const uploadUrl = authData.upload.url;

  // Upload PUT
  const putRes = await fetch(`${BASE_URL}${uploadUrl}`, {
    method: "PUT",
    headers: {
      ...sessionHeaders,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    body: fileBuffer,
  });
  if (!putRes.ok) throw new Error(`Falha no upload PUT de ${fileName}: ${putRes.status}`);

  // Complete upload
  const completeRes = await fetch(`${BASE_URL}/api/sessions/${sessionId}/uploads/complete`, {
    method: "POST",
    headers: { ...sessionHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
  if (!completeRes.ok) throw new Error(`Falha no complete de ${fileName}: ${completeRes.status}`);
  console.log(`   -> ${fileName} (${fileStat.size} bytes) enviado com sucesso!`);
}

main().catch((err) => {
  console.error("Erro durante o teste:", err);
  process.exit(1);
});
