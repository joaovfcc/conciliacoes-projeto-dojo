from decimal import Decimal
from pathlib import Path

from conciliacao.adapters import read_bank
from conciliacao.errors import FileValidationError, PdfValidationError
from conciliacao.models import ExtractionMethod, PdfPageContent
from conciliacao.pdf_statements.extraction import PdfStatementReader
from conciliacao.pdf_statements.service import read_pdf_statement
from conciliacao.pdf_statements.settings import PdfSettings

FIXTURES = Path(__file__).parents[1] / "fixtures" / "pdf-statements"


class SyntheticOcr:
    def __init__(self, text: str, confidence: str = "95"):
        self.text = text
        self.confidence = Decimal(confidence)
        self.pages: list[int] = []

    def extract_page(self, path, page_number, settings, temp_directory):
        self.pages.append(page_number)
        return PdfPageContent(
            page_number=page_number,
            text=self.text,
            extraction_method=ExtractionMethod.OCR,
            confidence=self.confidence,
        )


class PartialOcr(SyntheticOcr):
    def extract_page(self, path, page_number, settings, temp_directory):
        if page_number == 2:
            raise PdfValidationError("Página ilegível no OCR.", "PAGINA_OCR_ILEGIVEL")
        return super().extract_page(path, page_number, settings, temp_directory)


def test_reader_extracts_searchable_text_without_ocr():
    path = FIXTURES / "text-based" / "EXTRATO_ITAU_1234_567890_202607.pdf"
    ocr = SyntheticOcr("não deve ser usado")

    document = PdfStatementReader(PdfSettings.from_environment({}), ocr).read(path)

    assert document.page_count == 1
    assert document.extraction_method is ExtractionMethod.TEXT
    assert "PAGAMENTO FORNECEDOR" in document.pages[0].text
    assert ocr.pages == []


def test_reader_detects_scanned_pdf_and_uses_configured_ocr():
    path = FIXTURES / "scanned" / "EXTRATO_ITAU_1234_567890_202607.pdf"
    ocr = SyntheticOcr("BANCO ITAU - EXTRATO CONTA CORRENTE\nAGENCIA: 1234 CONTA: 567890")
    settings = PdfSettings.from_environment({"PDF_ENABLE_OCR": "SIM"})

    document = PdfStatementReader(settings, ocr).read(path)

    assert ocr.pages == [1]
    assert document.extraction_method is ExtractionMethod.OCR
    assert document.pages[0].confidence == Decimal("95")
    assert document.pages[0].extraction_method is ExtractionMethod.OCR


def test_reader_reports_scanned_pdf_when_ocr_is_disabled():
    path = FIXTURES / "scanned" / "EXTRATO_ITAU_1234_567890_202607.pdf"

    try:
        PdfStatementReader(PdfSettings.from_environment({})).read(path)
    except FileValidationError as error:
        assert error.code == "OCR_DESABILITADO"
        assert "PDF_ENABLE_OCR" in str(error)
    else:
        raise AssertionError("PDF digitalizado deveria exigir OCR")


def test_text_pdf_is_normalized_to_the_existing_bank_record_contract():
    path = FIXTURES / "text-based" / "EXTRATO_ITAU_1234_567890_202607.pdf"

    result = read_pdf_statement(path, "202607")

    assert not result.errors
    assert [item.value for item in result.records] == [Decimal("-100.00"), Decimal("250.00")]
    assert result.records[0].source_page == 1
    assert result.records[0].source_text.startswith("05/07")
    assert result.records[0].parser_name == "ITAU_TEXTO_V1"
    assert result.records[0].extraction_method == "TEXT"
    assert result.metadata["page_count"] == 1
    assert result.metadata["valid_record_count"] == 2
    assert result.metadata["rejected_record_count"] == 0


def test_multi_page_pdf_removes_repeated_headers_and_tracks_each_page():
    path = FIXTURES / "multi-page" / "EXTRATO_ITAU_1234_567890_202607.pdf"

    result = read_bank(path, "202607")

    assert not result.errors
    assert len(result.records) == 3
    assert [item.source_page for item in result.records] == [1, 2, 2]
    assert all("DATA DESCRICAO" not in item.description for item in result.records)
    assert result.metadata["page_count"] == 2


def test_protected_corrupted_and_zero_page_pdfs_are_controlled():
    invalid = FIXTURES / "invalid"
    cases = {
        "EXTRATO_ITAU_1234_999999_202607.pdf": "PDF_PROTEGIDO",
        "EXTRATO_ITAU_1234_567890_202607.pdf": "PDF_CORROMPIDO",
        "EXTRATO_ITAU_1234_000000_202607.pdf": "PDF_SEM_PAGINAS",
    }

    for filename, expected_code in cases.items():
        result = read_pdf_statement(invalid / filename, "202607")
        assert result.records == []
        assert result.errors[0].code == expected_code


def test_unknown_layout_never_invents_transactions():
    path = FIXTURES / "unsupported-layout" / "EXTRATO_OUTRO_1234_567890_202607.pdf"

    result = read_pdf_statement(path, "202607")

    assert result.records == []
    assert result.errors[0].code == "LAYOUT_PDF_NAO_RECONHECIDO"
    assert "não foi reconhecido" in result.errors[0].description


def test_extension_with_non_pdf_signature_is_rejected(tmp_path):
    path = tmp_path / "EXTRATO_ITAU_1234_567890_202607.pdf"
    path.write_bytes("arquivo que não é PDF".encode())

    result = read_pdf_statement(path, "202607")

    assert result.errors[0].code == "ASSINATURA_PDF_INVALIDA"


def test_partial_ocr_preserves_readable_page_and_reports_failed_page():
    path = FIXTURES / "scanned" / "EXTRATO_ITAU_1234_888888_202607.pdf"
    ocr = PartialOcr(
        "BANCO ITAU - EXTRATO CONTA CORRENTE\n"
        "AGENCIA: 1234 CONTA: 888888\n"
        "PERIODO: 01/07/2026 A 31/07/2026\n"
        "DATA DESCRICAO DOCUMENTO VALOR SALDO\n"
        "05/07 PAGAMENTO TESTE 001 100,00 D 900,00 C"
    )
    settings = PdfSettings.from_environment({"PDF_ENABLE_OCR": "SIM"})

    document = PdfStatementReader(settings, ocr).read(path)

    assert len(document.pages) == 1
    assert document.pages[0].page_number == 1
    assert document.errors[0].code == "PAGINA_OCR_ILEGIVEL"
    assert document.errors[0].line == "Página 2"


def test_low_ocr_confidence_rejects_each_transaction_individually():
    path = FIXTURES / "scanned" / "EXTRATO_ITAU_1234_567890_202607.pdf"
    ocr = SyntheticOcr(
        "BANCO ITAU - EXTRATO CONTA CORRENTE\n"
        "AGENCIA: 1234 CONTA: 567890\n"
        "PERIODO: 01/07/2026 A 31/07/2026\n"
        "DATA DESCRICAO DOCUMENTO VALOR SALDO\n"
        "05/07 PAGAMENTO TESTE 001 100,00 D 900,00 C\n"
        "06/07 PIX TESTE 002 250,00 C 1.150,00 C",
        confidence="55",
    )
    settings = PdfSettings.from_environment(
        {"PDF_ENABLE_OCR": "SIM", "PDF_OCR_MIN_CONFIDENCE": "70"}
    )

    result = read_pdf_statement(path, "202607", settings=settings, ocr_extractor=ocr)

    assert result.records == []
    assert [error.code for error in result.errors] == [
        "BAIXA_CONFIANCA_OCR",
        "BAIXA_CONFIANCA_OCR",
    ]
    assert {error.line for error in result.errors} == {"Página 1"}
    assert result.metadata["rejected_record_count"] == 2


def test_reader_enforces_page_and_file_size_limits(tmp_path):
    multi_page = FIXTURES / "multi-page" / "EXTRATO_ITAU_1234_567890_202607.pdf"
    settings = PdfSettings.from_environment({"PDF_MAX_PAGES": "1"})

    try:
        PdfStatementReader(settings).read(multi_page)
    except FileValidationError as error:
        assert error.code == "LIMITE_PAGINAS_PDF"
    else:
        raise AssertionError("O limite de páginas deveria rejeitar o PDF")

    oversized = tmp_path / "EXTRATO_ITAU_1234_567890_202607.pdf"
    oversized.write_bytes(b"%PDF-" + b"0" * (1024 * 1024 + 1))
    size_settings = PdfSettings.from_environment({"PDF_MAX_FILE_SIZE_MB": "1"})
    try:
        PdfStatementReader(size_settings).read(oversized)
    except FileValidationError as error:
        assert error.code == "LIMITE_TAMANHO_PDF"
    else:
        raise AssertionError("O limite de tamanho deveria rejeitar o PDF")
