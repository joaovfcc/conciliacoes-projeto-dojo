import ExcelJS from 'exceljs';

async function inspect(filePath) {
  console.log(`\n=== FILE: ${filePath} ===`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  wb.eachSheet(sheet => {
    console.log(`--- Sheet: ${sheet.name} (rows: ${sheet.rowCount}) ---`);
    for (let i = 1; i <= Math.min(sheet.rowCount, 25); i++) {
      const row = sheet.getRow(i);
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
          vals.push(`[col ${col}] ${cell.value}`);
        }
      });
      if (vals.length > 0) {
        console.log(`Row ${i}: ${vals.join(' | ')}`);
      }
    }
  });
}

await inspect('docs/mocks/1225_11102012_1808_1847.xlsx');
await inspect('docs/mocks/santander_130002439.xlsx');
