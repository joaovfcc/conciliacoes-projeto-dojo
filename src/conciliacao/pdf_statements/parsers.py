"""Detecção de layout e parsers bancários extensíveis."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from hashlib import sha256
from typing import Protocol

from conciliacao.errors import DataValidationError, PdfValidationError
from conciliacao.models import (
    BankStatement,
    BankTransaction,
    ExtractionMethod,
    FileDescriptor,
    PdfRawDocument,
    TechnicalError,
    TransactionType,
)
from conciliacao.normalization import normalize_document, parse_date, parse_money

TRANSACTION_PATTERN = re.compile(
    r"^(?P<date>\d{2}/\d{2}(?:/\d{4})?)\s+"
    r"(?P<description>.+?)\s+"
    r"(?P<document>[A-Z0-9./-]+)\s+"
    r"(?P<amount>\(?[-+]?\d[\d.]*,\d{2}-?\)?)\s*(?P<marker>CR|DB|C|D)?"
    r"(?:\s+(?P<balance>\(?[-+]?\d[\d.]*,\d{2}-?\)?)"
    r"\s*(?P<balance_marker>CR|DB|C|D)?)?$",
    re.IGNORECASE,
)
BALANCE_PATTERN = re.compile(
    r"^SALDO\s+(?P<kind>ANTERIOR|INICIAL|FINAL)\s+"
    r"(?P<amount>\(?[-+]?\d[\d.]*,\d{2}-?\)?)"
    r"\s*(?P<marker>CR|DB|C|D)?$",
    re.IGNORECASE,
)
PERIOD_PATTERN = re.compile(
    r"PERIODO\s*:\s*(?P<start>\d{2}/\d{2}/\d{4})\s+(?:A|ATE)\s+"
    r"(?P<end>\d{2}/\d{2}/\d{4})",
    re.IGNORECASE,
)
ACCOUNT_PATTERN = re.compile(
    r"AGENCIA\s*:\s*(?P<agency>[A-Z0-9-]+)\s+CONTA\s*:\s*(?P<account>[A-Z0-9-]+)",
    re.IGNORECASE,
)
HOLDER_PATTERN = re.compile(r"TITULAR\s*:\s*(?P<holder>.+)$", re.IGNORECASE | re.MULTILINE)


class BankStatementParser(Protocol):
    name: str

    def can_parse(self, document: PdfRawDocument, descriptor: FileDescriptor) -> bool: ...

    def parse(self, document: PdfRawDocument, descriptor: FileDescriptor) -> BankStatement: ...


class BankLayoutDetector:
    def __init__(self, parsers: Sequence[BankStatementParser] | None = None):
        self.parsers = tuple(parsers or (ItauStatementParser(), GenericStatementParser()))

    def detect(
        self, document: PdfRawDocument, descriptor: FileDescriptor
    ) -> BankStatementParser | None:
        return next(
            (parser for parser in self.parsers if parser.can_parse(document, descriptor)), None
        )


class ItauStatementParser:
    name = "ITAU_TEXTO_V1"

    def can_parse(self, document: PdfRawDocument, descriptor: FileDescriptor) -> bool:
        content = _normalized_text(document)
        return "BANCO ITAU" in content and "EXTRATO CONTA CORRENTE" in content

    def parse(self, document: PdfRawDocument, descriptor: FileDescriptor) -> BankStatement:
        return _parse_tabular_statement(document, descriptor, self.name, bank="ITAU")


class GenericStatementParser:
    """Fallback conservador: exige cabeçalho e linhas tabulares explícitas."""

    name = "GENERICO_TABELAR_V1"

    def can_parse(self, document: PdfRawDocument, descriptor: FileDescriptor) -> bool:
        content = _normalized_text(document)
        return "DATA DESCRICAO DOCUMENTO VALOR SALDO" in content and any(
            TRANSACTION_PATTERN.match(line.strip())
            for page in document.pages
            for line in page.text.splitlines()
        )

    def parse(self, document: PdfRawDocument, descriptor: FileDescriptor) -> BankStatement:
        return _parse_tabular_statement(
            document, descriptor, self.name, bank=descriptor.bank or "NAO_IDENTIFICADO"
        )


def parse_pdf_amount(raw_value: str, marker: str = "") -> tuple[Decimal, TransactionType]:
    """Normaliza valor e natureza sem inferir crédito de valor absoluto positivo."""
    text = str(raw_value).strip().upper().replace(" ", "")
    suffix = re.search(r"(CR|DB|C|D)$", text)
    detected_marker = marker.strip().upper() or (suffix.group(1) if suffix else "")
    if suffix:
        text = text[: suffix.start()]
    trailing_negative = text.endswith("-")
    if trailing_negative:
        text = f"-{text[:-1]}"
    explicit_debit = text.startswith("-") or text.startswith("(") or trailing_negative
    value = parse_money(text)
    if detected_marker in {"D", "DB"}:
        return -abs(value), TransactionType.DEBITO
    if detected_marker in {"C", "CR"}:
        return abs(value), TransactionType.CREDITO
    if explicit_debit or value < 0:
        return -abs(value), TransactionType.DEBITO
    return abs(value), TransactionType.INDEFINIDO


def parse_statement_date(raw_value: str, period: str | None) -> date:
    text = str(raw_value).strip()
    if re.fullmatch(r"\d{2}/\d{2}/\d{4}", text):
        return parse_date(text)
    if not re.fullmatch(r"\d{2}/\d{2}", text):
        raise DataValidationError(f'A data "{raw_value}" do PDF é inválida.')
    if not period:
        raise DataValidationError(
            f'A data "{raw_value}" não possui ano e o período do extrato não está disponível.'
        )
    if not re.fullmatch(r"\d{6}", period):
        raise DataValidationError(f'O período "{period}" do extrato é inválido.')
    day, month = map(int, text.split("/"))
    expected_month = int(period[4:])
    if month != expected_month:
        raise DataValidationError(
            f'A data "{raw_value}" não pertence ao período do extrato {period}.'
        )
    try:
        return date(int(period[:4]), month, day)
    except ValueError as exc:
        raise DataValidationError(f'A data "{raw_value}" do PDF é inválida.') from exc


def _parse_tabular_statement(
    document: PdfRawDocument,
    descriptor: FileDescriptor,
    parser_name: str,
    *,
    bank: str,
) -> BankStatement:
    all_text = "\n".join(page.text for page in document.pages)
    period_start, period_end = _extract_period(all_text, descriptor.period)
    agency, account = _extract_account(all_text, descriptor)
    if descriptor.agency and agency != descriptor.agency:
        raise PdfValidationError(
            f"A agência {agency} extraída do PDF difere do nome do arquivo.",
            "AGENCIA_PDF_DIVERGENTE",
        )
    if descriptor.account and account != descriptor.account:
        raise PdfValidationError(
            f"A conta {account} extraída do PDF difere do nome do arquivo.",
            "CONTA_PDF_DIVERGENTE",
        )
    holder_match = HOLDER_PATTERN.search(_ascii_text(all_text))
    holder = holder_match.group("holder").strip() if holder_match else ""
    opening_balance: Decimal | None = None
    closing_balance: Decimal | None = None
    preliminary: list[dict[str, object]] = []
    warnings = list(document.warnings)
    errors = list(document.errors)
    pending: dict[str, object] | None = None

    for page in document.pages:
        for raw_line in page.text.splitlines():
            line = " ".join(raw_line.strip().split())
            normalized = _ascii_text(line).upper()
            if not line or _ignored_line(normalized):
                continue
            if balance_match := BALANCE_PATTERN.match(normalized):
                amount, _ = parse_pdf_amount(
                    balance_match.group("amount"), balance_match.group("marker") or ""
                )
                if balance_match.group("kind").upper() in {"ANTERIOR", "INICIAL"}:
                    opening_balance = amount
                else:
                    closing_balance = amount
                continue
            source_page = page.page_number
            source_text = line
            confidence = page.confidence
            extraction_method = page.extraction_method
            transaction_warnings = list(page.warnings)
            transaction_input = normalized
            if pending:
                if re.match(r"^\d{2}/\d{2}(?:/\d{4})?\b", normalized):
                    errors.append(_incomplete_movement_error(document.source_file, pending))
                    pending = None
                else:
                    combined = f"{pending['line']} {normalized}"
                    if TRANSACTION_PATTERN.match(combined):
                        transaction_input = combined
                        source_page = int(pending["page"])
                        source_text = f"{pending['source_text']} | {line}"
                        confidence = min(pending["confidence"], page.confidence)
                        extraction_method = (
                            pending["extraction_method"]
                            if pending["extraction_method"] is page.extraction_method
                            else ExtractionMethod.MIXED
                        )
                        transaction_warnings = [
                            *pending["warnings"],
                            *page.warnings,
                            "Movimentação quebrada entre páginas e reagrupada na página seguinte.",
                        ]
                        pending = None
                    else:
                        pending["line"] = combined
                        pending["source_text"] = f"{pending['source_text']} | {line}"
                        continue
            transaction_match = TRANSACTION_PATTERN.match(transaction_input)
            if transaction_match:
                try:
                    amount, transaction_type = parse_pdf_amount(
                        transaction_match.group("amount"),
                        transaction_match.group("marker") or "",
                    )
                    balance = None
                    if transaction_match.group("balance"):
                        balance, _ = parse_pdf_amount(
                            transaction_match.group("balance"),
                            transaction_match.group("balance_marker") or "",
                        )
                    preliminary.append(
                        {
                            "date": parse_statement_date(
                                transaction_match.group("date"), descriptor.period
                            ),
                            "description": transaction_match.group("description").strip(),
                            "document": normalize_document(transaction_match.group("document")),
                            "amount": amount,
                            "type": transaction_type,
                            "balance": balance,
                            "page": source_page,
                            "source_text": source_text,
                            "confidence": confidence,
                            "extraction_method": extraction_method,
                            "warnings": transaction_warnings,
                        }
                    )
                except DataValidationError as exc:
                    errors.append(
                        TechnicalError(
                            file=document.source_file,
                            stage="PARSER_PDF",
                            code="MOVIMENTACAO_PDF_INVALIDA",
                            description=f'Página {source_page}, trecho "{source_text}": {exc}',
                            line=f"Página {source_page}",
                            guidance="Corrija ou revise manualmente a movimentação indicada.",
                            occurred_at=datetime.now(UTC),
                        )
                    )
                continue
            if re.match(r"^\d{2}/\d{2}(?:/\d{4})?\b", normalized):
                pending = {
                    "line": normalized,
                    "source_text": line,
                    "page": page.page_number,
                    "confidence": page.confidence,
                    "extraction_method": page.extraction_method,
                    "warnings": list(page.warnings),
                }
                continue
            if preliminary and _is_description_continuation(normalized):
                item = preliminary[-1]
                item["description"] = f"{item['description']} {line}".strip()
                item["source_text"] = f"{item['source_text']} | {line}"

    if pending:
        errors.append(_incomplete_movement_error(document.source_file, pending))

    transactions: list[BankTransaction] = []
    seen: set[str] = set()
    for item in preliminary:
        unique_id = _transaction_id(bank, agency, account, item)
        if unique_id in seen:
            warnings.append(
                f"Movimentação duplicada identificada na página {item['page']}: "
                f"{item['source_text']}"
            )
            continue
        seen.add(unique_id)
        transactions.append(
            BankTransaction(
                transaction_date=item["date"],
                description=str(item["description"]),
                document_number=str(item["document"]),
                amount=item["amount"],
                transaction_type=item["type"],
                balance=item["balance"],
                source_page=int(item["page"]),
                source_text=str(item["source_text"]),
                confidence=item["confidence"],
                unique_id=unique_id,
                extraction_method=item["extraction_method"],
                warnings=tuple(item["warnings"]),
            )
        )

    if opening_balance is not None and closing_balance is not None:
        calculated = opening_balance + sum(
            (transaction.amount for transaction in transactions), Decimal("0.00")
        )
        if abs(calculated - closing_balance) > Decimal("0.01"):
            errors.append(
                TechnicalError(
                    file=document.source_file,
                    stage="VALIDACAO_SALDO_PDF",
                    code="SALDO_INCONSISTENTE",
                    description=(
                        f"Saldo calculado {calculated:.2f} difere do saldo final "
                        f"{closing_balance:.2f}."
                    ),
                    line=None,
                    guidance="Revise movimentações, saldo inicial e saldo final do extrato.",
                    occurred_at=datetime.now(UTC),
                )
            )
    return BankStatement(
        bank=bank,
        agency=agency,
        account=account,
        holder=holder,
        period_start=period_start,
        period_end=period_end,
        opening_balance=opening_balance,
        closing_balance=closing_balance,
        transactions=tuple(transactions),
        source_file=document.source_file,
        extraction_method=document.extraction_method,
        parser_name=parser_name,
        page_count=document.page_count,
        warnings=tuple(warnings),
        errors=tuple(errors),
        duration_seconds=document.duration_seconds,
    )


def _extract_period(content: str, fallback: str) -> tuple[date, date]:
    normalized = _ascii_text(content)
    if match := PERIOD_PATTERN.search(normalized):
        return parse_date(match.group("start")), parse_date(match.group("end"))
    if not re.fullmatch(r"\d{6}", fallback):
        raise PdfValidationError(
            "O período do extrato não pôde ser determinado com segurança.",
            "PERIODO_PDF_INDEFINIDO",
        )
    year, month = int(fallback[:4]), int(fallback[4:])
    next_month = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return date(year, month, 1), date.fromordinal(next_month.toordinal() - 1)


def _incomplete_movement_error(source_file: str, pending: dict[str, object]) -> TechnicalError:
    page = int(pending["page"])
    return TechnicalError(
        file=source_file,
        stage="PARSER_PDF",
        code="MOVIMENTACAO_PDF_INCOMPLETA",
        description=(
            f'Página {page}, trecho "{pending["source_text"]}": não foi possível identificar '
            "todos os campos da movimentação."
        ),
        line=f"Página {page}",
        guidance="Revise data, descrição, documento, valor e natureza.",
        occurred_at=datetime.now(UTC),
    )


def _extract_account(content: str, descriptor: FileDescriptor) -> tuple[str, str]:
    match = ACCOUNT_PATTERN.search(_ascii_text(content))
    if not match:
        if descriptor.agency and descriptor.account:
            return descriptor.agency, descriptor.account
        raise PdfValidationError(
            "Agência e conta não puderam ser identificadas no extrato PDF.",
            "CONTA_PDF_INDEFINIDA",
        )
    return match.group("agency").upper(), match.group("account").upper()


def _transaction_id(bank: str, agency: str, account: str, item: dict[str, object]) -> str:
    key = "|".join(
        [
            bank,
            agency,
            account,
            str(item["date"]),
            str(item["document"]),
            str(item["amount"]),
            _ascii_text(str(item["description"])).upper(),
        ]
    )
    return f"PDF-{sha256(key.encode()).hexdigest()[:16].upper()}"


def _ignored_line(line: str) -> bool:
    prefixes = (
        "BANCO ITAU",
        "TITULAR:",
        "AGENCIA:",
        "PERIODO:",
        "DATA DESCRICAO DOCUMENTO VALOR SALDO",
        "PAGINA ",
        "DOCUMENTO GERADO",
    )
    return line.startswith(prefixes)


def _is_description_continuation(line: str) -> bool:
    return not (
        line.startswith(("SALDO ", "TOTAL ", "LANCAMENTOS FUTUROS"))
        or re.match(r"^\d{2}/\d{2}", line)
    )


def _normalized_text(document: PdfRawDocument) -> str:
    return _ascii_text("\n".join(page.text for page in document.pages)).upper()


def _ascii_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(character for character in normalized if not unicodedata.combining(character))
