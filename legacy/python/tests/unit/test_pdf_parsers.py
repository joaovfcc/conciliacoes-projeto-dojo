from decimal import Decimal
from pathlib import Path

from conciliacao.models import (
    ExtractionMethod,
    FileDescriptor,
    PdfPageContent,
    PdfRawDocument,
    TransactionType,
)
from conciliacao.pdf_statements.parsers import (
    BankLayoutDetector,
    GenericStatementParser,
    ItauStatementParser,
)


def descriptor(bank="ITAU", account="567890"):
    return FileDescriptor(
        path=Path(f"EXTRATO_{bank}_1234_{account}_202607.pdf"),
        file_type="EXTRATO",
        period="202607",
        extension="PDF",
        bank=bank,
        agency="1234",
        account=account,
    )


def raw_document(*pages):
    return PdfRawDocument(
        source_file="EXTRATO_ITAU_1234_567890_202607.pdf",
        page_count=len(pages),
        pages=tuple(
            PdfPageContent(
                page_number=index,
                text=text,
                extraction_method=ExtractionMethod.TEXT,
                confidence=Decimal("100.00"),
            )
            for index, text in enumerate(pages, start=1)
        ),
        extraction_method=ExtractionMethod.TEXT,
        duration_seconds=Decimal("0.10"),
    )


HEADER = """BANCO ITAU - EXTRATO CONTA CORRENTE
TITULAR: EMPRESA DEMONSTRACAO
AGENCIA: 1234 CONTA: 567890
PERIODO: 01/07/2026 A 31/07/2026
DATA DESCRICAO DOCUMENTO VALOR SALDO"""


def test_detector_selects_itau_parser_and_rejects_unknown_layout():
    detector = BankLayoutDetector([ItauStatementParser()])

    assert detector.detect(raw_document(HEADER), descriptor()).name == "ITAU_TEXTO_V1"
    assert detector.detect(raw_document("RELATORIO SEM LAYOUT"), descriptor("OUTRO")) is None


def test_detector_uses_generic_parser_only_for_explicit_tabular_contract():
    document = raw_document(
        """EXTRATO PADRAO
AGENCIA: 1234 CONTA: 567890
PERIODO: 01/07/2026 A 31/07/2026
DATA DESCRICAO DOCUMENTO VALOR SALDO
05/07 PAGAMENTO TESTE 001 100,00 D 900,00 C"""
    )

    parser = BankLayoutDetector().detect(document, descriptor("OUTRO"))

    assert isinstance(parser, GenericStatementParser)
    assert parser.parse(document, descriptor("OUTRO")).bank == "OUTRO"


def test_detector_parses_itau_empresas_ocr_layout_and_filters_target_period():
    document = raw_document(
        """ItauEmpresas
Extrato de conta corrente
Nome: EMPRESA DEMONSTRACAO
Agencia: 0191 Conta: 26775-6
Extrato - Por Periodo 29/01/2026 a 02/03/2026
Data Lancamento Valor (R$) Saldo (R$)
01/02 SISPAG TRIBUTOS 9129 1.234,56-
01/02 TED RECEBIDA 4321 5.000,00
01/02 PGTO ITAU 65114 8643 2,685,28
01/02 SISPAG FORNECEDORES 9953 \u2014-1.300.000,00-
01/02 SISPAG TRIBUTOS 9132 2.941 ,62-
01/02 REND PAGO APLIC AUT MAIS. 17,28
01/02 SALDO DO DIA 8.765,44
01/02 SALDO 1,00
02/03 TARIFA FORA DO PERIODO 9999 10,00-"""
    )
    real_descriptor = FileDescriptor(
        path=Path("EXTRATO_ITAU_0191_26775-6_202602.pdf"),
        file_type="EXTRATO",
        period="202602",
        extension="PDF",
        bank="ITAU",
        agency="0191",
        account="26775-6",
    )

    parser = BankLayoutDetector().detect(document, real_descriptor)
    statement = parser.parse(document, real_descriptor)

    assert parser.name == "ITAU_EMPRESAS_OCR_V1"
    assert statement.period_start.isoformat() == "2026-01-29"
    assert statement.period_end.isoformat() == "2026-03-02"
    assert [item.amount for item in statement.transactions] == [
        Decimal("-1234.56"),
        Decimal("5000.00"),
        Decimal("2685.28"),
        Decimal("-1300000.00"),
        Decimal("-2941.62"),
        Decimal("17.28"),
    ]
    assert [item.transaction_type for item in statement.transactions] == [
        TransactionType.DEBITO,
        TransactionType.CREDITO,
        TransactionType.CREDITO,
        TransactionType.DEBITO,
        TransactionType.DEBITO,
        TransactionType.CREDITO,
    ]
    assert statement.transactions[0].document_number == "9129"
    assert any("fora do período" in warning for warning in statement.warnings)


def test_itau_empresas_parser_preserves_identical_real_movements():
    document = raw_document(
        """ItauEmpresas
Extrato de conta corrente
Nome: EMPRESA DEMONSTRACAO
Agencia: 0191 Conta: 26775-6
Extrato - Por Periodo 01/12/2025 a 31/12/2025
16/12 SISPAG FORNECEDORES 9131 35,00-
16/12 SISPAG FORNECEDORES 9131 35,00-"""
    )
    real_descriptor = FileDescriptor(
        path=Path("EXTRATO_ITAU_0191_26775-6_202512.pdf"),
        file_type="EXTRATO",
        period="202512",
        extension="PDF",
        bank="ITAU",
        agency="0191",
        account="26775-6",
    )

    parser = BankLayoutDetector().detect(document, real_descriptor)
    statement = parser.parse(document, real_descriptor)

    assert [item.amount for item in statement.transactions] == [
        Decimal("-35.00"),
        Decimal("-35.00"),
    ]
    assert len({item.unique_id for item in statement.transactions}) == 2


def test_itau_parser_groups_multiline_description_and_ignores_headers():
    document = raw_document(
        f"""{HEADER}
SALDO ANTERIOR 1.000,00 C
05/07 PAGAMENTO FORNECEDOR 001 100,00 D 900,00 C
COMPLEMENTO DA DESCRICAO
06/07 PIX RECEBIDO 002 250,00 C 1.150,00 C
SALDO FINAL 1.150,00 C
Pagina 1 de 1"""
    )

    statement = ItauStatementParser().parse(document, descriptor())

    assert statement.bank == "ITAU"
    assert statement.agency == "1234"
    assert statement.account == "567890"
    assert statement.holder == "EMPRESA DEMONSTRACAO"
    assert statement.period_start.isoformat() == "2026-07-01"
    assert statement.period_end.isoformat() == "2026-07-31"
    assert statement.opening_balance == Decimal("1000.00")
    assert statement.closing_balance == Decimal("1150.00")
    assert len(statement.transactions) == 2
    assert statement.transactions[0].amount == Decimal("-100.00")
    assert statement.transactions[0].description.endswith("COMPLEMENTO DA DESCRICAO")
    assert statement.transactions[0].source_page == 1
    assert statement.transactions[0].source_text.startswith("05/07")
    assert statement.errors == ()


def test_parser_deduplicates_same_transaction_and_warns():
    transaction = "05/07 PAGAMENTO FORNECEDOR 001 100,00 D 900,00 C"
    document = raw_document(f"{HEADER}\n{transaction}\n{transaction}")

    statement = ItauStatementParser().parse(document, descriptor())

    assert len(statement.transactions) == 1
    assert any("duplicada" in warning.lower() for warning in statement.warnings)


def test_parser_evidences_inconsistent_balance_without_discarding_transactions():
    document = raw_document(
        f"""{HEADER}
SALDO ANTERIOR 1.000,00 C
05/07 PAGAMENTO FORNECEDOR 001 100,00 D 900,00 C
SALDO FINAL 950,00 C"""
    )

    statement = ItauStatementParser().parse(document, descriptor())

    assert len(statement.transactions) == 1
    assert any(error.code == "SALDO_INCONSISTENTE" for error in statement.errors)


def test_parser_reports_incomplete_movement_with_page_and_original_excerpt():
    document = raw_document(
        f"""{HEADER}
05/07 PAGAMENTO SEM VALOR
06/07 PIX RECEBIDO 002 250,00 C 1.250,00 C"""
    )

    statement = ItauStatementParser().parse(document, descriptor())

    error = next(error for error in statement.errors if error.code == "MOVIMENTACAO_PDF_INCOMPLETA")
    assert error.line == "Página 1"
    assert "05/07 PAGAMENTO SEM VALOR" in error.description
    assert len(statement.transactions) == 1


def test_parser_reassembles_movement_broken_between_pages():
    document = raw_document(
        f"""{HEADER}
05/07 PAGAMENTO FORNECEDOR 001""",
        f"""{HEADER}
100,00 D 900,00 C""",
    )

    statement = ItauStatementParser().parse(document, descriptor())

    assert len(statement.transactions) == 1
    assert statement.transactions[0].amount == Decimal("-100.00")
    assert statement.transactions[0].source_page == 1
    assert "100,00 D" in statement.transactions[0].source_text
    assert any(
        "página seguinte" in warning.lower() for warning in statement.transactions[0].warnings
    )
