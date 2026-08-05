"""Descoberta e classificação segura dos arquivos de entrada."""

from __future__ import annotations

import hashlib
import re
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from conciliacao.errors import FileValidationError
from conciliacao.models import FileDescriptor, TechnicalError

LEDGER_PATTERN = re.compile(
    r"^RAZAO_(?P<company>[A-Z0-9_-]+)_(?P<branch>[A-Z0-9_-]+)_(?P<period>\d{6})"
    r"\.(?P<extension>xlsx|csv)$",
    re.IGNORECASE,
)
BANK_PATTERN = re.compile(
    r"^EXTRATO_(?P<bank>[A-Z0-9_-]+)_(?P<agency>[A-Z0-9_-]+)_"
    r"(?P<account>[A-Z0-9_-]+)_(?P<period>\d{6})\.(?P<extension>ofx|xlsx|csv|pdf)$",
    re.IGNORECASE,
)


def parse_input_filename(path: Path) -> FileDescriptor:
    """Extrai identidade apenas de nomes aderentes ao contrato do PRD."""
    path = Path(path)
    match = LEDGER_PATTERN.fullmatch(path.name)
    if match:
        values = match.groupdict()
        return FileDescriptor(
            path=path,
            file_type="RAZAO",
            company=values["company"].upper(),
            branch=values["branch"].upper(),
            period=values["period"],
            extension=values["extension"].upper(),
        )
    match = BANK_PATTERN.fullmatch(path.name)
    if match:
        values = match.groupdict()
        return FileDescriptor(
            path=path,
            file_type="EXTRATO",
            bank=values["bank"].upper(),
            agency=values["agency"].upper(),
            account=values["account"].upper(),
            period=values["period"],
            extension=values["extension"].upper(),
        )
    raise FileValidationError(
        f'O arquivo "{path.name}" não segue a nomenclatura aprovada para razão ou extrato.'
    )


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def discover_input_files(
    base_dir: Path, period: str
) -> tuple[list[FileDescriptor], list[TechnicalError]]:
    """Lista arquivos válidos e transforma rejeições em diagnósticos explícitos."""
    base_dir = Path(base_dir).resolve()
    folders = (base_dir / "01_Entrada" / "Razao", base_dir / "01_Entrada" / "Extratos")
    discovered: list[FileDescriptor] = []
    errors: list[TechnicalError] = []
    hashes: dict[str, Path] = {}
    now = datetime.now(UTC)
    for folder in folders:
        if not folder.exists():
            continue
        for path in sorted(item for item in folder.iterdir() if item.is_file()):
            if path.name.startswith(("~$", ".")):
                continue
            try:
                descriptor = parse_input_filename(path)
                if path.stat().st_size == 0:
                    raise FileValidationError(f'O arquivo "{path.name}" está vazio.')
                if descriptor.period != period:
                    errors.append(
                        _error(
                            path,
                            "DESCOBERTA",
                            "PERIODO_DIVERGENTE",
                            f"O nome informa período {descriptor.period}, não {period}.",
                            "Mova o arquivo para a competência correta ou corrija o nome.",
                            now,
                        )
                    )
                    continue
                descriptor = replace(descriptor, sha256=file_sha256(path))
                if original := hashes.get(descriptor.sha256):
                    errors.append(
                        _error(
                            path,
                            "DESCOBERTA",
                            "ARQUIVO_DUPLICADO",
                            f'O conteúdo é idêntico ao arquivo "{original.name}".',
                            "Mantenha apenas uma cópia do conteúdo na entrada.",
                            now,
                        )
                    )
                    continue
                hashes[descriptor.sha256] = path
                discovered.append(descriptor)
            except (FileValidationError, OSError) as exc:
                errors.append(
                    _error(
                        path,
                        "DESCOBERTA",
                        getattr(exc, "code", "ERRO_DE_LEITURA"),
                        str(exc),
                        "Corrija o nome, a extensão, o conteúdo ou a permissão do arquivo.",
                        now,
                    )
                )
    return discovered, errors


def _error(
    path: Path,
    stage: str,
    code: str,
    description: str,
    guidance: str,
    occurred_at: datetime,
) -> TechnicalError:
    return TechnicalError(
        file=path.name,
        stage=stage,
        code=code,
        description=description,
        line=None,
        guidance=guidance,
        occurred_at=occurred_at,
    )
