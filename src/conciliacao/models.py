"""Contratos do domínio, independentes dos formatos de arquivo."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from pathlib import Path
from typing import Any, TypeAlias


class Status(StrEnum):
    CONCILIADO_EXATO = "CONCILIADO_EXATO"
    CONCILIADO_TOLERANCIA_DATA = "CONCILIADO_TOLERANCIA_DATA"
    CONCILIADO_VALOR_DATA = "CONCILIADO_VALOR_DATA"
    DIVERGENCIA_VALOR = "DIVERGENCIA_VALOR"
    DIVERGENCIA_DATA = "DIVERGENCIA_DATA"
    RAZAO_SEM_EXTRATO = "RAZAO_SEM_EXTRATO"
    EXTRATO_SEM_RAZAO = "EXTRATO_SEM_RAZAO"
    MULTIPLAS_CORRESPONDENCIAS = "MULTIPLAS_CORRESPONDENCIAS"
    POSSIVEL_DUPLICIDADE = "POSSIVEL_DUPLICIDADE"
    ERRO_DE_DADOS = "ERRO_DE_DADOS"
    ARQUIVO_REJEITADO = "ARQUIVO_REJEITADO"


class TransactionType(StrEnum):
    CREDITO = "CREDITO"
    DEBITO = "DEBITO"
    INDEFINIDO = "INDEFINIDO"


class ExtractionMethod(StrEnum):
    TEXT = "TEXT"
    OCR = "OCR"
    MIXED = "MIXED"


@dataclass(frozen=True, slots=True)
class AccountConfig:
    company: str
    branch: str
    ledger_account: str
    description: str
    bank: str
    agency: str
    bank_account: str
    accepted_format: str
    date_tolerance: int
    value_tolerance: Decimal
    primary_rule: str
    active: bool = True
    responsible: str = ""

    @property
    def bank_key(self) -> tuple[str, str, str]:
        return self.bank, self.agency, self.bank_account


@dataclass(frozen=True, slots=True)
class LedgerRecord:
    record_id: str
    company: str
    branch: str
    ledger_account: str
    date: date
    document: str
    history: str
    value: Decimal
    nature: str
    source_id: str
    source_file: str
    source_line: int


@dataclass(frozen=True, slots=True)
class BankRecord:
    record_id: str
    bank: str
    agency: str
    bank_account: str
    date: date
    document: str
    history: str
    value: Decimal
    nature: str
    source_id: str
    source_file: str
    source_line: int | str
    source_page: int | None = None
    source_text: str = ""
    extraction_method: str = ""
    parser_name: str = ""
    confidence: Decimal | None = None
    balance: Decimal | None = None
    warnings: tuple[str, ...] = ()

    @property
    def description(self) -> str:
        return self.history


SourceRecord: TypeAlias = LedgerRecord | BankRecord


@dataclass(frozen=True, slots=True)
class ReconciliationResult:
    result_id: str
    status: Status
    rule: str
    reason: str
    ledger: LedgerRecord | None = None
    bank: BankRecord | None = None
    candidates: tuple[BankRecord, ...] = ()
    value_difference: Decimal | None = None
    date_difference: int | None = None
    tolerance_days: int = 0
    tolerance_value: Decimal = Decimal("0.00")


@dataclass(frozen=True, slots=True)
class TechnicalError:
    file: str
    stage: str
    code: str
    description: str
    line: int | str | None
    guidance: str
    occurred_at: datetime


@dataclass(frozen=True, slots=True)
class PdfPageContent:
    page_number: int
    text: str
    extraction_method: ExtractionMethod
    confidence: Decimal
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class PdfRawDocument:
    source_file: str
    page_count: int
    pages: tuple[PdfPageContent, ...]
    extraction_method: ExtractionMethod
    duration_seconds: Decimal
    warnings: tuple[str, ...] = ()
    errors: tuple[TechnicalError, ...] = ()


@dataclass(frozen=True, slots=True)
class BankTransaction:
    transaction_date: date
    description: str
    document_number: str
    amount: Decimal
    transaction_type: TransactionType
    balance: Decimal | None
    source_page: int
    source_text: str
    confidence: Decimal
    unique_id: str
    extraction_method: ExtractionMethod
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class BankStatement:
    bank: str
    agency: str
    account: str
    holder: str
    period_start: date
    period_end: date
    opening_balance: Decimal | None
    closing_balance: Decimal | None
    transactions: tuple[BankTransaction, ...]
    source_file: str
    extraction_method: ExtractionMethod
    parser_name: str
    page_count: int
    warnings: tuple[str, ...] = ()
    errors: tuple[TechnicalError, ...] = ()
    duration_seconds: Decimal = Decimal("0.00")


@dataclass(frozen=True, slots=True)
class ProcessedFile:
    path: Path
    file_type: str
    period: str
    sha256: str
    record_count: int
    company: str = ""
    bank: str = ""
    agency: str = ""
    account: str = ""
    total_debit: Decimal = Decimal("0.00")
    total_credit: Decimal = Decimal("0.00")
    status: str = "PROCESSADO"
    page_count: int = 0
    extraction_method: str = ""
    valid_record_count: int = 0
    rejected_record_count: int = 0
    warning_count: int = 0
    duration_seconds: Decimal = Decimal("0.00")


@dataclass(slots=True)
class ProcessingOutcome:
    period: str
    report_path: Path
    log_path: Path
    results: list[ReconciliationResult]
    processed_files: list[ProcessedFile]
    errors: list[TechnicalError] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class ApplicationConfig:
    accounts: tuple[AccountConfig, ...]
    parameters: dict[str, str]
    layouts: tuple[dict[str, str], ...]
    sha256: str


@dataclass(frozen=True, slots=True)
class FileDescriptor:
    path: Path
    file_type: str
    period: str
    extension: str
    sha256: str = ""
    company: str = ""
    branch: str = ""
    bank: str = ""
    agency: str = ""
    account: str = ""


@dataclass(slots=True)
class ReadResult:
    records: list[SourceRecord] = field(default_factory=list)
    errors: list[TechnicalError] = field(default_factory=list)
    total_debit: Decimal = Decimal("0.00")
    total_credit: Decimal = Decimal("0.00")
    warnings: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
