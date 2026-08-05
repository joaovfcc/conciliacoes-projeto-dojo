from datetime import date, datetime
from decimal import Decimal

import pytest

from conciliacao.errors import DataValidationError
from conciliacao.normalization import normalize_document, parse_date, parse_money


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1.234,56", Decimal("1234.56")),
        ("-1.234,56", Decimal("-1234.56")),
        ("1,234.56", Decimal("1234.56")),
        ("(1,500.25)", Decimal("-1500.25")),
        (125, Decimal("125.00")),
        (Decimal("0.009"), Decimal("0.01")),
    ],
)
def test_parse_money_accepts_accounting_formats(raw, expected):
    assert parse_money(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "abc", float("nan")])
def test_parse_money_rejects_missing_or_invalid_values(raw):
    with pytest.raises(DataValidationError, match="valor"):
        parse_money(raw)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("31/07/2026", date(2026, 7, 31)),
        ("2026-07-31", date(2026, 7, 31)),
        (datetime(2026, 7, 31, 10, 30), date(2026, 7, 31)),
    ],
)
def test_parse_date_accepts_supported_values(raw, expected):
    assert parse_date(raw) == expected


def test_parse_date_rejects_invalid_calendar_date():
    with pytest.raises(DataValidationError, match="data"):
        parse_date("31/02/2026")


def test_normalize_document_preserves_leading_zeroes():
    assert normalize_document("  nf-001/23 ") == "NF00123"
