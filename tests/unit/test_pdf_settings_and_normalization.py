from decimal import Decimal
from pathlib import Path

import pytest

from conciliacao.errors import ConfigurationError, DataValidationError
from conciliacao.models import TransactionType
from conciliacao.pdf_statements.parsers import parse_pdf_amount, parse_statement_date
from conciliacao.pdf_statements.settings import PdfSettings


def test_pdf_settings_have_safe_defaults():
    settings = PdfSettings.from_environment({})

    assert settings.max_file_size_mb == 25
    assert settings.max_pages == 100
    assert settings.extraction_timeout_seconds == 120
    assert settings.enable_ocr is False
    assert settings.ocr_language == "por"
    assert settings.min_text_length == 40
    assert settings.ocr_min_confidence == Decimal("70.00")
    assert settings.temp_directory is None


def test_pdf_settings_load_environment_overrides(tmp_path):
    settings = PdfSettings.from_environment(
        {
            "PDF_MAX_FILE_SIZE_MB": "10",
            "PDF_MAX_PAGES": "20",
            "PDF_EXTRACTION_TIMEOUT_SECONDS": "30",
            "PDF_ENABLE_OCR": "SIM",
            "PDF_OCR_LANGUAGE": "por+eng",
            "PDF_MIN_TEXT_LENGTH": "12",
            "PDF_OCR_MIN_CONFIDENCE": "82,5",
            "PDF_TEMP_DIRECTORY": str(tmp_path),
        }
    )

    assert settings.max_file_size_mb == 10
    assert settings.max_pages == 20
    assert settings.extraction_timeout_seconds == 30
    assert settings.enable_ocr is True
    assert settings.ocr_language == "por+eng"
    assert settings.min_text_length == 12
    assert settings.ocr_min_confidence == Decimal("82.50")
    assert settings.temp_directory == Path(tmp_path).resolve()


@pytest.mark.parametrize(
    ("environment", "message"),
    [
        ({"PDF_MAX_PAGES": "0"}, "PDF_MAX_PAGES"),
        ({"PDF_ENABLE_OCR": "talvez"}, "PDF_ENABLE_OCR"),
        ({"PDF_OCR_MIN_CONFIDENCE": "101"}, "PDF_OCR_MIN_CONFIDENCE"),
    ],
)
def test_pdf_settings_reject_unsafe_values(environment, message):
    with pytest.raises(ConfigurationError, match=message):
        PdfSettings.from_environment(environment)


@pytest.mark.parametrize(
    ("raw", "marker", "expected_amount", "expected_type"),
    [
        ("1.234,56", "C", Decimal("1234.56"), TransactionType.CREDITO),
        ("1.234,56", "D", Decimal("-1234.56"), TransactionType.DEBITO),
        ("1.234,56CR", "", Decimal("1234.56"), TransactionType.CREDITO),
        ("1.234,56DB", "", Decimal("-1234.56"), TransactionType.DEBITO),
        ("1.234,56-", "", Decimal("-1234.56"), TransactionType.DEBITO),
        ("-1.234,56", "", Decimal("-1234.56"), TransactionType.DEBITO),
        ("1.234,56", "", Decimal("1234.56"), TransactionType.INDEFINIDO),
    ],
)
def test_pdf_amount_uses_markers_and_signs(raw, marker, expected_amount, expected_type):
    amount, transaction_type = parse_pdf_amount(raw, marker)

    assert amount == expected_amount
    assert transaction_type is expected_type


def test_date_without_year_uses_only_the_declared_statement_period():
    assert parse_statement_date("05/07", "202607").isoformat() == "2026-07-05"

    with pytest.raises(DataValidationError, match="período"):
        parse_statement_date("05/08", "202607")


def test_date_without_year_is_rejected_without_statement_period():
    with pytest.raises(DataValidationError, match="ano"):
        parse_statement_date("05/07", None)
