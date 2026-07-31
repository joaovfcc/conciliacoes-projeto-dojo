"""Fachada que entrega PDFs no mesmo contrato dos demais extratos."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from conciliacao.discovery import parse_input_filename
from conciliacao.errors import ConciliacaoError, PdfValidationError
from conciliacao.models import BankRecord, ReadResult, TechnicalError, TransactionType
from conciliacao.pdf_statements.extraction import OcrExtractor, PdfStatementReader
from conciliacao.pdf_statements.parsers import BankLayoutDetector
from conciliacao.pdf_statements.settings import PdfSettings


class PdfStatementImportService:
    def __init__(
        self,
        settings: PdfSettings | None = None,
        ocr_extractor: OcrExtractor | None = None,
        detector: BankLayoutDetector | None = None,
    ):
        self.settings = settings or PdfSettings.from_environment()
        self.reader = PdfStatementReader(self.settings, ocr_extractor)
        self.detector = detector or BankLayoutDetector()

    def read(self, path: Path, period: str) -> ReadResult:
        path = Path(path)
        started = time.monotonic()
        result = ReadResult()
        try:
            descriptor = parse_input_filename(path)
            document = self.reader.read(path)
            parser = self.detector.detect(document, descriptor)
            if parser is None:
                raise PdfValidationError(
                    "O layout do extrato não foi reconhecido automaticamente.",
                    "LAYOUT_PDF_NAO_RECONHECIDO",
                )
            statement = parser.parse(document, descriptor)
            result.errors.extend(statement.errors)
            result.warnings.extend(statement.warnings)
            rejected = sum(
                error.code in {"MOVIMENTACAO_PDF_INVALIDA", "MOVIMENTACAO_PDF_INCOMPLETA"}
                for error in statement.errors
            )
            for transaction in statement.transactions:
                validation_error = self._validate_transaction(
                    path, period, transaction, statement.parser_name
                )
                if validation_error:
                    result.errors.append(validation_error)
                    rejected += 1
                    continue
                result.records.append(
                    BankRecord(
                        record_id=transaction.unique_id,
                        bank=statement.bank,
                        agency=statement.agency,
                        bank_account=statement.account,
                        date=transaction.transaction_date,
                        document=transaction.document_number,
                        history=transaction.description,
                        value=transaction.amount,
                        nature=transaction.transaction_type.value,
                        source_id=transaction.unique_id,
                        source_file=path.name,
                        source_line=f"Página {transaction.source_page}",
                        source_page=transaction.source_page,
                        source_text=transaction.source_text,
                        extraction_method=transaction.extraction_method.value,
                        parser_name=statement.parser_name,
                        confidence=transaction.confidence,
                        balance=transaction.balance,
                        warnings=transaction.warnings,
                    )
                )
                if transaction.amount < 0:
                    result.total_debit += abs(transaction.amount)
                elif transaction.amount > 0:
                    result.total_credit += transaction.amount
            result.metadata.update(
                {
                    "bank": statement.bank,
                    "agency": statement.agency,
                    "account": statement.account,
                    "period_start": statement.period_start.isoformat(),
                    "period_end": statement.period_end.isoformat(),
                    "page_count": statement.page_count,
                    "extraction_method": statement.extraction_method.value,
                    "parser_name": statement.parser_name,
                    "transaction_count": len(statement.transactions) + rejected,
                    "valid_record_count": len(result.records),
                    "rejected_record_count": rejected,
                    "warning_count": len(result.warnings)
                    + sum(len(item.warnings) for item in statement.transactions),
                }
            )
            if not statement.transactions:
                result.errors.append(
                    _technical_error(
                        path,
                        "PARSER_PDF",
                        "PDF_SEM_MOVIMENTACOES",
                        "Nenhuma movimentação segura foi extraída do PDF.",
                        "Confirme o layout e a legibilidade do extrato.",
                    )
                )
        except ConciliacaoError as exc:
            result.errors.append(
                _technical_error(
                    path,
                    "LEITURA_PDF",
                    exc.code,
                    str(exc),
                    "Revise o arquivo, os limites e a configuração de PDF/OCR.",
                )
            )
        except Exception as exc:
            result.errors.append(
                _technical_error(
                    path,
                    "LEITURA_PDF",
                    "ERRO_PROCESSAMENTO_PDF",
                    (
                        f'Não foi possível processar "{path.name}" devido a uma falha controlada '
                        f"na leitura ({type(exc).__name__})."
                    ),
                    "Revise o arquivo e encaminhe o log técnico ao suporte.",
                )
            )
        duration = Decimal(str(time.monotonic() - started)).quantize(
            Decimal("0.001"), rounding=ROUND_HALF_UP
        )
        result.metadata.setdefault("page_count", 0)
        result.metadata.setdefault("extraction_method", "")
        result.metadata.setdefault("parser_name", "")
        result.metadata.setdefault("transaction_count", 0)
        result.metadata.setdefault("valid_record_count", len(result.records))
        result.metadata.setdefault("rejected_record_count", len(result.errors))
        result.metadata.setdefault("warning_count", len(result.warnings))
        result.metadata["duration_seconds"] = duration
        return result

    def _validate_transaction(
        self, path: Path, period: str, transaction, parser_name: str
    ) -> TechnicalError | None:
        if transaction.transaction_type is TransactionType.INDEFINIDO:
            return _technical_error(
                path,
                "VALIDACAO_TRANSACAO_PDF",
                "NATUREZA_INDEFINIDA",
                f'Não foi possível classificar crédito/débito em "{transaction.source_text}".',
                f"Revise a página {transaction.source_page} e o parser {parser_name}.",
                transaction.source_page,
            )
        if transaction.confidence < self.settings.ocr_min_confidence:
            return _technical_error(
                path,
                "VALIDACAO_TRANSACAO_PDF",
                "BAIXA_CONFIANCA_OCR",
                (
                    f"Confiança OCR {transaction.confidence:.2f}% abaixo do mínimo "
                    f"{self.settings.ocr_min_confidence:.2f}%."
                ),
                f"Revise manualmente o trecho da página {transaction.source_page}.",
                transaction.source_page,
            )
        if transaction.transaction_date.strftime("%Y%m") != period:
            return _technical_error(
                path,
                "VALIDACAO_TRANSACAO_PDF",
                "PERIODO_TRANSACAO_PDF_DIVERGENTE",
                (
                    f"A data {transaction.transaction_date:%d/%m/%Y} não pertence ao período "
                    f"{period}."
                ),
                "Revise o período do arquivo ou a data extraída.",
                transaction.source_page,
            )
        if not transaction.description.strip():
            return _technical_error(
                path,
                "VALIDACAO_TRANSACAO_PDF",
                "DESCRICAO_PDF_AUSENTE",
                "A movimentação não possui descrição.",
                f"Revise a página {transaction.source_page}.",
                transaction.source_page,
            )
        return None


def read_pdf_statement(
    path: Path,
    period: str,
    *,
    settings: PdfSettings | None = None,
    ocr_extractor: OcrExtractor | None = None,
) -> ReadResult:
    return PdfStatementImportService(settings, ocr_extractor).read(path, period)


def _technical_error(
    path: Path,
    stage: str,
    code: str,
    description: str,
    guidance: str,
    page: int | None = None,
) -> TechnicalError:
    return TechnicalError(
        file=path.name,
        stage=stage,
        code=code,
        description=description,
        line=f"Página {page}" if page else None,
        guidance=guidance,
        occurred_at=datetime.now(UTC),
    )
