"""Configuração segura para leitura de PDFs e OCR opcional."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

from conciliacao.errors import ConfigurationError
from conciliacao.normalization import parse_money


@dataclass(frozen=True, slots=True)
class PdfSettings:
    max_file_size_mb: int = 25
    max_pages: int = 100
    extraction_timeout_seconds: int = 120
    enable_ocr: bool = False
    ocr_language: str = "por"
    min_text_length: int = 40
    ocr_min_confidence: Decimal = Decimal("70.00")
    temp_directory: Path | None = None
    ocr_command: str = "tesseract"
    render_command: str = "pdftoppm"

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> PdfSettings:
        values = os.environ if environment is None else environment
        max_file_size = _positive_int(values, "PDF_MAX_FILE_SIZE_MB", 25)
        max_pages = _positive_int(values, "PDF_MAX_PAGES", 100)
        timeout = _positive_int(values, "PDF_EXTRACTION_TIMEOUT_SECONDS", 120)
        min_text = _positive_int(values, "PDF_MIN_TEXT_LENGTH", 40)
        enable_ocr = _boolean(values, "PDF_ENABLE_OCR", False)
        confidence = parse_money(values.get("PDF_OCR_MIN_CONFIDENCE", "70"))
        if not Decimal("0") <= confidence <= Decimal("100"):
            raise ConfigurationError("PDF_OCR_MIN_CONFIDENCE deve estar entre 0 e 100.")
        temp_value = values.get("PDF_TEMP_DIRECTORY", "").strip()
        temp_directory = Path(temp_value).resolve() if temp_value else None
        return cls(
            max_file_size_mb=max_file_size,
            max_pages=max_pages,
            extraction_timeout_seconds=timeout,
            enable_ocr=enable_ocr,
            ocr_language=values.get("PDF_OCR_LANGUAGE", "por").strip() or "por",
            min_text_length=min_text,
            ocr_min_confidence=confidence,
            temp_directory=temp_directory,
        )


def _positive_int(values: Mapping[str, str], name: str, default: int) -> int:
    raw = values.get(name, str(default))
    try:
        parsed = int(raw)
    except (TypeError, ValueError) as exc:
        raise ConfigurationError(f"{name} deve ser um número inteiro positivo.") from exc
    if parsed <= 0:
        raise ConfigurationError(f"{name} deve ser maior que zero.")
    return parsed


def _boolean(values: Mapping[str, str], name: str, default: bool) -> bool:
    raw = values.get(name, "SIM" if default else "NAO").strip().upper()
    if raw in {"SIM", "TRUE", "1", "YES"}:
        return True
    if raw in {"NAO", "NÃO", "FALSE", "0", "NO"}:
        return False
    raise ConfigurationError(f"{name} deve ser SIM ou NAO.")
