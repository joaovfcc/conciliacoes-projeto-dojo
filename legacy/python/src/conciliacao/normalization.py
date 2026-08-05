"""Conversões explícitas para o modelo interno."""

from __future__ import annotations

import math
import re
import unicodedata
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from conciliacao.errors import DataValidationError

CENT = Decimal("0.01")


def parse_money(value: Any) -> Decimal:
    """Converte formatos contábeis comuns sem usar ponto flutuante no domínio."""
    if value is None or isinstance(value, bool):
        raise DataValidationError("O valor monetário está ausente ou é inválido.")
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        raise DataValidationError("O valor monetário está ausente ou é inválido.")

    if isinstance(value, Decimal):
        parsed = value
    elif isinstance(value, int | float):
        parsed = Decimal(str(value))
    else:
        text = str(value).strip()
        if not text:
            raise DataValidationError("O valor monetário está ausente.")
        negative_parentheses = text.startswith("(") and text.endswith(")")
        text = text.removeprefix("(").removesuffix(")")
        text = re.sub(r"[^0-9,.+\-]", "", text)
        if text.count("-") > 1 or ("-" in text and not text.startswith("-")):
            raise DataValidationError(f'O valor monetário "{value}" é inválido.')
        if "," in text and "." in text:
            if text.rfind(",") > text.rfind("."):
                text = text.replace(".", "").replace(",", ".")
            else:
                text = text.replace(",", "")
        elif "," in text:
            text = text.replace(".", "").replace(",", ".")
        try:
            parsed = Decimal(text)
        except InvalidOperation as exc:
            raise DataValidationError(f'O valor monetário "{value}" é inválido.') from exc
        if negative_parentheses:
            parsed = -abs(parsed)

    if not parsed.is_finite():
        raise DataValidationError("O valor monetário está ausente ou é inválido.")
    return parsed.quantize(CENT, rounding=ROUND_HALF_UP)


def parse_date(value: Any) -> date:
    """Converte datas ISO ou brasileiras para ``date``."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value is None:
        raise DataValidationError("A data está ausente.")

    text = str(value).strip()
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y%m%d"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    raise DataValidationError(f'A data "{value}" é inválida ou usa formato não suportado.')


def normalize_document(value: Any) -> str:
    """Padroniza referência sem converter para número ou perder zeros à esquerda."""
    if value is None:
        return ""
    text = str(value).strip().upper()
    if text.endswith(".0") and text[:-2].isdigit():
        text = text[:-2]
    return "".join(character for character in text if character.isalnum())


def normalize_header(value: Any) -> str:
    """Remove acentos e pontuação de cabeçalhos para comparação estável."""
    text = unicodedata.normalize("NFKD", str(value or ""))
    ascii_text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^A-Z0-9]+", "_", ascii_text.upper()).strip("_")


def normalize_code(value: Any) -> str:
    """Normaliza códigos de empresa, conta, agência ou banco."""
    if value is None:
        return ""
    text = str(value).strip().upper()
    if text.endswith(".0") and text[:-2].replace("-", "").isdigit():
        text = text[:-2]
    return re.sub(r"\s+", "", text)
