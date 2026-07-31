from decimal import Decimal

from openpyxl import Workbook

from conciliacao.adapters import read_bank, read_ledger


def test_ledger_csv_imports_valid_rows_and_reports_invalid_rows(tmp_path):
    path = tmp_path / "RAZAO_SPREAD_MATRIZ_202607.csv"
    path.write_text(
        "Empresa;Filial;Conta contábil;Data;Documento;Histórico;Débito;Crédito;Identificador\n"
        "SPREAD;MATRIZ;1.1.1.01.001;28/07/2026;001;Pagamento;100,00;0;L1\n"
        "SPREAD;MATRIZ;1.1.1.01.001;29/07/2026;002;Recebimento;0;250,50;L2\n"
        "SPREAD;MATRIZ;1.1.1.01.001;31/02/2026;003;Inválido;0;10;L3\n",
        encoding="utf-8",
    )

    result = read_ledger(path, "202607")

    assert [record.value for record in result.records] == [
        Decimal("-100.00"),
        Decimal("250.50"),
    ]
    assert result.records[0].source_line == 2
    assert result.records[0].document == "001"
    assert len(result.errors) == 1
    assert result.errors[0].line == 4
    assert result.total_debit == Decimal("100.00")
    assert result.total_credit == Decimal("250.50")


def test_bank_xlsx_uses_filename_identity_and_keeps_source_line(tmp_path):
    path = tmp_path / "EXTRATO_ITAU_1234_567890_202607.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Data", "Documento", "Histórico", "Valor", "Identificador bancário"])
    sheet.append(["28/07/2026", "001", "Pagamento", "-100,00", "FIT-1"])
    workbook.save(path)

    result = read_bank(path, "202607")

    assert len(result.errors) == 0
    assert result.records[0].bank == "ITAU"
    assert result.records[0].agency == "1234"
    assert result.records[0].bank_account == "567890"
    assert result.records[0].source_id == "FIT-1"
    assert result.records[0].value == Decimal("-100.00")
    assert result.records[0].source_line == 2


def test_ofx_adapter_reads_sgml_transactions_without_external_service(tmp_path):
    path = tmp_path / "EXTRATO_ITAU_1234_567890_202607.ofx"
    path.write_text(
        "OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n<OFX><BANKMSGSRSV1><STMTTRNRS>"
        "<STMTRS><BANKACCTFROM><BANKID>341<BRANCHID>1234<ACCTID>567890</BANKACCTFROM>"
        "<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260728120000[-3:BRT]"
        "<TRNAMT>-100.00<FITID>FIT-1<CHECKNUM>001<MEMO>Pagamento</STMTTRN>"
        "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
        encoding="latin-1",
    )

    result = read_bank(path, "202607")

    assert len(result.errors) == 0
    assert len(result.records) == 1
    assert result.records[0].date.isoformat() == "2026-07-28"
    assert result.records[0].value == Decimal("-100.00")
    assert result.records[0].document == "001"
    assert result.records[0].source_line == "FIT-1"


def test_adapter_rejects_missing_required_columns(tmp_path):
    path = tmp_path / "EXTRATO_ITAU_1234_567890_202607.csv"
    path.write_text("Data;Documento\n28/07/2026;001\n", encoding="utf-8")

    result = read_bank(path, "202607")

    assert result.records == []
    assert result.errors[0].code == "COLUNAS_AUSENTES"
    assert "VALOR" in result.errors[0].description
