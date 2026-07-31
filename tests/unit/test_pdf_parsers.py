from decimal import Decimal
from pathlib import Path

from conciliacao.models import ExtractionMethod, FileDescriptor, PdfPageContent, PdfRawDocument
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
