"""Validação, extração direta e fallback OCR página a página."""

from __future__ import annotations

import csv
import shutil
import subprocess
import tempfile
import time
from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Protocol

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from conciliacao.errors import PdfValidationError
from conciliacao.models import (
    ExtractionMethod,
    PdfPageContent,
    PdfRawDocument,
    TechnicalError,
)
from conciliacao.pdf_statements.settings import PdfSettings


class OcrExtractor(Protocol):
    def extract_page(
        self,
        path: Path,
        page_number: int,
        settings: PdfSettings,
        temp_directory: Path,
    ) -> PdfPageContent: ...


class PdfStatementReader:
    def __init__(
        self, settings: PdfSettings | None = None, ocr_extractor: OcrExtractor | None = None
    ):
        self.settings = settings or PdfSettings.from_environment()
        self.ocr_extractor = ocr_extractor

    def read(self, path: Path) -> PdfRawDocument:
        path = Path(path)
        started = time.monotonic()
        self._validate_file(path)
        try:
            reader = PdfReader(path, strict=False)
        except (PdfReadError, OSError, ValueError) as exc:
            raise PdfValidationError(
                f'Não foi possível processar "{path.name}" porque o PDF está corrompido.',
                "PDF_CORROMPIDO",
            ) from exc
        if reader.is_encrypted:
            raise PdfValidationError(
                f'Não foi possível processar "{path.name}" porque o PDF está protegido por senha.',
                "PDF_PROTEGIDO",
            )
        page_count = len(reader.pages)
        if page_count == 0:
            raise PdfValidationError(
                f'O arquivo "{path.name}" não contém páginas.', "PDF_SEM_PAGINAS"
            )
        if page_count > self.settings.max_pages:
            raise PdfValidationError(
                f"O PDF possui {page_count} páginas; o limite é {self.settings.max_pages}.",
                "LIMITE_PAGINAS_PDF",
            )

        pages: list[PdfPageContent] = []
        errors: list[TechnicalError] = []
        warnings: list[str] = []
        used_text = False
        used_ocr = False
        temp_root = self.settings.temp_directory
        if temp_root:
            temp_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="conciliacao_pdf_", dir=temp_root) as temp_name:
            temp_directory = Path(temp_name)
            safe_pdf = temp_directory / "input.pdf"
            shutil.copyfile(path, safe_pdf)
            for index, page in enumerate(reader.pages, start=1):
                self._check_timeout(started, path)
                try:
                    text = (page.extract_text(extraction_mode="layout") or "").strip()
                except Exception as exc:
                    text = ""
                    warnings.append(
                        f"Página {index}: extração direta falhou ({type(exc).__name__})."
                    )
                if len(_meaningful_text(text)) >= self.settings.min_text_length:
                    pages.append(
                        PdfPageContent(
                            page_number=index,
                            text=text,
                            extraction_method=ExtractionMethod.TEXT,
                            confidence=Decimal("100.00"),
                        )
                    )
                    used_text = True
                    continue
                if not self.settings.enable_ocr:
                    errors.append(
                        _page_error(
                            path,
                            index,
                            "OCR_DESABILITADO",
                            (
                                "A página não possui texto pesquisável suficiente e o OCR está "
                                "desabilitado."
                            ),
                            "Habilite PDF_ENABLE_OCR somente em ambiente com Poppler e Tesseract.",
                        )
                    )
                    continue
                extractor = self.ocr_extractor or TesseractOcrExtractor()
                try:
                    ocr_page = extractor.extract_page(
                        safe_pdf, index, self.settings, temp_directory
                    )
                    if len(_meaningful_text(ocr_page.text)) < self.settings.min_text_length:
                        raise PdfValidationError(
                            f"A página {index} não produziu texto OCR suficiente.",
                            "OCR_INCOMPLETO",
                        )
                    pages.append(ocr_page)
                    used_ocr = True
                except (PdfValidationError, OSError, subprocess.SubprocessError) as exc:
                    errors.append(
                        _page_error(
                            path,
                            index,
                            getattr(exc, "code", "FALHA_OCR"),
                            str(exc),
                            "Revise a página digitalizada e a instalação do OCR.",
                        )
                    )

        if not pages:
            if errors and all(error.code == "OCR_DESABILITADO" for error in errors):
                raise PdfValidationError(
                    f'O PDF "{path.name}" é digitalizado. Defina PDF_ENABLE_OCR=SIM para usar OCR.',
                    "OCR_DESABILITADO",
                )
            raise PdfValidationError(
                f'Nenhuma página de "{path.name}" pôde ser interpretada.', "FALHA_OCR"
            )
        method = (
            ExtractionMethod.MIXED
            if used_text and used_ocr
            else ExtractionMethod.OCR
            if used_ocr
            else ExtractionMethod.TEXT
        )
        duration = Decimal(str(time.monotonic() - started)).quantize(
            Decimal("0.001"), rounding=ROUND_HALF_UP
        )
        return PdfRawDocument(
            source_file=path.name,
            page_count=page_count,
            pages=tuple(pages),
            extraction_method=method,
            duration_seconds=duration,
            warnings=tuple(warnings),
            errors=tuple(errors),
        )

    def _validate_file(self, path: Path) -> None:
        if not path.is_file():
            raise PdfValidationError(f'O arquivo PDF "{path}" não existe.', "PDF_INEXISTENTE")
        if path.suffix.lower() != ".pdf":
            raise PdfValidationError(
                f'A extensão "{path.suffix}" não é aceita pelo leitor de PDF.',
                "EXTENSAO_PDF_INVALIDA",
            )
        size = path.stat().st_size
        if size == 0:
            raise PdfValidationError(f'O arquivo "{path.name}" está vazio.', "PDF_VAZIO")
        if size > self.settings.max_file_size_mb * 1024 * 1024:
            raise PdfValidationError(
                f"O PDF excede o limite de {self.settings.max_file_size_mb} MB.",
                "LIMITE_TAMANHO_PDF",
            )
        with path.open("rb") as stream:
            if stream.read(5) != b"%PDF-":
                raise PdfValidationError(
                    f'O conteúdo de "{path.name}" não possui assinatura real de PDF.',
                    "ASSINATURA_PDF_INVALIDA",
                )

    def _check_timeout(self, started: float, path: Path) -> None:
        if time.monotonic() - started > self.settings.extraction_timeout_seconds:
            raise PdfValidationError(
                f'A leitura de "{path.name}" excedeu o limite de tempo configurado.',
                "TIMEOUT_EXTRACAO_PDF",
            )


class TesseractOcrExtractor:
    """OCR isolado em subprocessos com argumentos fixos e PDF sanitizado."""

    def extract_page(
        self,
        path: Path,
        page_number: int,
        settings: PdfSettings,
        temp_directory: Path,
    ) -> PdfPageContent:
        renderer = shutil.which(settings.render_command)
        tesseract = shutil.which(settings.ocr_command)
        if not renderer or not tesseract:
            raise PdfValidationError(
                "OCR indisponível: instale Poppler e Tesseract ou desabilite PDF_ENABLE_OCR.",
                "FERRAMENTA_OCR_INDISPONIVEL",
            )
        prefix = temp_directory / f"pagina_{page_number}"
        subprocess.run(
            [
                renderer,
                "-f",
                str(page_number),
                "-l",
                str(page_number),
                "-singlefile",
                "-png",
                "-r",
                "200",
                str(path),
                str(prefix),
            ],
            check=True,
            capture_output=True,
            timeout=settings.extraction_timeout_seconds,
        )
        image_path = prefix.with_suffix(".png")
        completed = subprocess.run(
            [
                tesseract,
                str(image_path),
                "stdout",
                "-l",
                settings.ocr_language,
                "--psm",
                "6",
                "tsv",
            ],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=settings.extraction_timeout_seconds,
        )
        text, confidence = _parse_tesseract_tsv(completed.stdout.splitlines())
        return PdfPageContent(
            page_number=page_number,
            text=text,
            extraction_method=ExtractionMethod.OCR,
            confidence=confidence,
            warnings=()
            if confidence >= settings.ocr_min_confidence
            else (f"Confiança OCR baixa: {confidence:.2f}%.",),
        )


def _parse_tesseract_tsv(lines: Sequence[str]) -> tuple[str, Decimal]:
    reader = csv.DictReader(lines, delimiter="\t")
    grouped: dict[tuple[str, str, str, str], list[str]] = {}
    confidences: list[Decimal] = []
    for row in reader:
        word = (row.get("text") or "").strip()
        if not word:
            continue
        key = (
            row.get("page_num", ""),
            row.get("block_num", ""),
            row.get("par_num", ""),
            row.get("line_num", ""),
        )
        grouped.setdefault(key, []).append(word)
        try:
            confidence = Decimal(row.get("conf", "-1"))
            if confidence >= 0:
                confidences.append(confidence)
        except Exception:
            continue
    text = "\n".join(" ".join(words) for words in grouped.values())
    average = sum(confidences, Decimal("0")) / len(confidences) if confidences else Decimal("0")
    return text, average.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _meaningful_text(value: str) -> str:
    return "".join(character for character in value if character.isalnum())


def _page_error(
    path: Path,
    page: int,
    code: str,
    description: str,
    guidance: str,
) -> TechnicalError:
    return TechnicalError(
        file=path.name,
        stage="EXTRACAO_PDF",
        code=code,
        description=description,
        line=f"Página {page}",
        guidance=guidance,
        occurred_at=datetime.now(UTC),
    )
