"""Caso de uso mensal: validar, conciliar, reportar e arquivar."""

from __future__ import annotations

import getpass
import json
import logging
import platform
import re
import shutil
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from conciliacao import __version__
from conciliacao.adapters import read_bank, read_ledger
from conciliacao.config import create_configuration_template, load_configuration
from conciliacao.discovery import discover_input_files, file_sha256
from conciliacao.errors import ConfigurationError, DuplicateFileError, FileValidationError
from conciliacao.models import (
    AccountConfig,
    BankRecord,
    FileDescriptor,
    LedgerRecord,
    ProcessedFile,
    ProcessingOutcome,
    ReadResult,
    TechnicalError,
)
from conciliacao.reconciliation import ReconciliationEngine
from conciliacao.reporting import ExcelReportGenerator

WORKSPACE_FOLDERS = (
    "01_Entrada/Razao",
    "01_Entrada/Extratos",
    "02_Processados",
    "03_Pendencias",
    "04_Resultados",
    "05_Configuracao",
)


def initialize_workspace(base_dir: Path) -> Path:
    """Cria a estrutura operacional sem sobrescrever configuração existente."""
    base_dir = Path(base_dir).resolve()
    for folder in WORKSPACE_FOLDERS:
        (base_dir / folder).mkdir(parents=True, exist_ok=True)
    configuration = base_dir / "05_Configuracao" / "CONFIGURACAO_CONTAS.xlsx"
    if not configuration.exists():
        create_configuration_template(configuration)
    return configuration


class ReconciliationProcessor:
    """Orquestra uma execução; efeitos só ocorrem após o relatório ser salvo."""

    def __init__(self, base_dir: Path):
        self.base_dir = Path(base_dir).resolve()

    def run(self, period: str, *, allow_reprocessing: bool = False) -> ProcessingOutcome:
        _validate_period(period)
        initialize_workspace(self.base_dir)
        executed_at = datetime.now(UTC)
        period_folder = f"{period[:4]}-{period[4:]}"
        results_dir = self.base_dir / "04_Resultados" / period_folder
        results_dir.mkdir(parents=True, exist_ok=True)
        log_path = results_dir / f"LOG_PROCESSAMENTO_{period}_{_timestamp(executed_at)}.txt"
        logger = _execution_logger(log_path)
        try:
            logger.info("Versão da aplicação: %s", __version__)
            logger.info("Início: %s", executed_at.isoformat())
            logger.info("Usuário/máquina: %s@%s", getpass.getuser(), platform.node())
            logger.info("Diretório: %s", self.base_dir)
            logger.info("Período: %s", period)
            configuration_path = self.base_dir / "05_Configuracao" / "CONFIGURACAO_CONTAS.xlsx"
            configuration = load_configuration(configuration_path)
            active_accounts = [account for account in configuration.accounts if account.active]
            if not active_accounts:
                raise ConfigurationError("Não há contas ativas na configuração.")

            descriptors, errors = discover_input_files(self.base_dir, period)
            discovery_rejected = _discovery_rejected_paths(self.base_dir, errors)
            logger.info("Arquivos encontrados: %d", len(descriptors))
            if not descriptors and not errors:
                raise FileValidationError(
                    f"Nenhum arquivo de entrada foi encontrado para o período {period}."
                )
            manifest = _load_manifest(self.base_dir)
            repeated = [item for item in descriptors if _hash_seen(manifest, item.sha256)]
            if repeated and not allow_reprocessing:
                names = ", ".join(item.path.name for item in repeated)
                raise DuplicateFileError(
                    f"O conteúdo já foi processado e exige --reprocessar: {names}."
                )

            ledgers: list[LedgerRecord] = []
            banks: list[BankRecord] = []
            accepted: list[tuple[FileDescriptor, ReadResult]] = []
            rejected: list[tuple[FileDescriptor, ReadResult]] = []
            processed_files: list[ProcessedFile] = [
                _discovery_rejected_file(path, period) for path in discovery_rejected
            ]

            for descriptor in descriptors:
                validation_error = _descriptor_configuration_error(descriptor, active_accounts)
                if validation_error:
                    read_result = ReadResult(errors=[validation_error])
                else:
                    read_result = (
                        read_ledger(descriptor.path, period)
                        if descriptor.file_type == "RAZAO"
                        else read_bank(descriptor.path, period)
                    )
                errors.extend(read_result.errors)
                if read_result.records:
                    accepted.append((descriptor, read_result))
                    if descriptor.file_type == "RAZAO":
                        ledgers.extend(
                            item for item in read_result.records if isinstance(item, LedgerRecord)
                        )
                    else:
                        banks.extend(
                            item for item in read_result.records if isinstance(item, BankRecord)
                        )
                    status = "PROCESSADO_COM_ALERTAS" if read_result.errors else "PROCESSADO"
                else:
                    rejected.append((descriptor, read_result))
                    status = "REJEITADO"
                processed_files.append(_processed_file(descriptor, read_result, status))

            logger.info("Arquivos aprovados: %d", len(accepted))
            logger.info("Arquivos rejeitados: %d", len(rejected) + len(discovery_rejected))
            logger.info("Registros válidos importados: %d", len(ledgers) + len(banks))
            logger.info(
                "Totais importados — débitos: %s; créditos: %s",
                sum((item.total_debit for item in processed_files), Decimal("0.00")),
                sum((item.total_credit for item in processed_files), Decimal("0.00")),
            )

            ledgers, ledger_mapping_errors = _filter_ledger_mapping(ledgers, active_accounts)
            banks, bank_mapping_errors = _filter_bank_mapping(banks, active_accounts)
            errors.extend(ledger_mapping_errors)
            errors.extend(bank_mapping_errors)

            reconciliation_results = []
            for account in active_accounts:
                account_ledgers = [
                    item
                    for item in ledgers
                    if (item.company, item.branch, item.ledger_account)
                    == (account.company, account.branch, account.ledger_account)
                ]
                account_banks = [
                    item
                    for item in banks
                    if (item.bank, item.agency, item.bank_account) == account.bank_key
                ]
                if not account_ledgers:
                    errors.append(_completeness_error(account, "RAZAO_AUSENTE", executed_at))
                if not account_banks:
                    errors.append(_completeness_error(account, "EXTRATO_AUSENTE", executed_at))
                reconciliation_results.extend(
                    ReconciliationEngine().reconcile(
                        account_ledgers, account_banks, account, period
                    )
                )

            company = _output_company(active_accounts, ledgers, descriptors)
            report_path = _versioned_path(
                results_dir / f"CONCILIACAO_{company}_{period}.xlsx", executed_at
            )
            ExcelReportGenerator().generate(
                report_path,
                results=reconciliation_results,
                accounts=active_accounts,
                processed_files=processed_files,
                errors=errors,
                executed_at=executed_at,
                configuration_hash=configuration.sha256,
            )
            logger.info("Relatório gerado: %s", report_path)

            archived = []
            for descriptor, _ in accepted:
                destination = self._archive(descriptor, period_folder, executed_at)
                if file_sha256(destination) != descriptor.sha256:
                    raise OSError(f"Falha de integridade após arquivar {descriptor.path.name}.")
                archived.append((descriptor, destination))
                logger.info("Arquivo processado arquivado: %s", destination)
            for descriptor, _ in rejected:
                destination = self._pending(descriptor.path, period_folder, executed_at)
                logger.warning("Arquivo rejeitado movido para pendências: %s", destination)
            for path in discovery_rejected:
                destination = self._pending(path, period_folder, executed_at)
                logger.warning(
                    "Arquivo rejeitado na descoberta movido para pendências: %s", destination
                )

            _append_manifest(
                self.base_dir,
                manifest,
                archived,
                period,
                executed_at,
                allow_reprocessing,
            )
            counts: dict[str, int] = {}
            for item in reconciliation_results:
                counts[item.status.value] = counts.get(item.status.value, 0) + 1
            logger.info("Resultados por status: %s", counts)
            logger.info("Regras executadas: REGRA_1 a REGRA_9, conforme aplicabilidade")
            logger.info("Erros e alertas: %d", len(errors))
            finished_at = datetime.now(UTC)
            logger.info("Término: %s", finished_at.isoformat())
            logger.info("Duração: %.3f segundos", (finished_at - executed_at).total_seconds())
            logger.info("Processamento concluído.")
            return ProcessingOutcome(
                period=period,
                report_path=report_path,
                log_path=log_path,
                results=reconciliation_results,
                processed_files=processed_files,
                errors=errors,
            )
        except Exception:
            logger.exception("Falha crítica; entradas ainda não arquivadas foram preservadas.")
            raise
        finally:
            _close_logger(logger)

    def _archive(
        self, descriptor: FileDescriptor, period_folder: str, executed_at: datetime
    ) -> Path:
        category = "Razao" if descriptor.file_type == "RAZAO" else "Extratos"
        folder = self.base_dir / "02_Processados" / period_folder / category
        folder.mkdir(parents=True, exist_ok=True)
        destination = _versioned_path(folder / descriptor.path.name, executed_at)
        shutil.move(str(descriptor.path), str(destination))
        return destination

    def _pending(self, path: Path, period_folder: str, executed_at: datetime) -> Path:
        folder = self.base_dir / "03_Pendencias" / period_folder
        folder.mkdir(parents=True, exist_ok=True)
        destination = _versioned_path(folder / path.name, executed_at)
        shutil.move(str(path), str(destination))
        return destination


def _descriptor_configuration_error(
    descriptor: FileDescriptor, accounts: list[AccountConfig]
) -> TechnicalError | None:
    if descriptor.file_type == "RAZAO":
        matching = [
            account
            for account in accounts
            if (account.company, account.branch) == (descriptor.company, descriptor.branch)
        ]
    else:
        matching = [
            account
            for account in accounts
            if account.bank_key
            == (
                descriptor.bank,
                descriptor.agency,
                descriptor.account,
            )
        ]
    if not matching:
        return _technical_error(
            descriptor.path.name,
            "RELACIONAMENTO",
            "CONTA_NAO_CONFIGURADA",
            "O arquivo não corresponde a nenhuma conta ativa na configuração.",
            "Cadastre empresa/filial ou banco/agência/conta na aba Contas.",
        )
    if descriptor.file_type == "EXTRATO" and not any(
        descriptor.extension in re.split(r"[,;/|]", account.accepted_format) for account in matching
    ):
        return _technical_error(
            descriptor.path.name,
            "VALIDACAO_FORMATO",
            "FORMATO_NAO_AUTORIZADO",
            f"O formato {descriptor.extension} não está autorizado para a conta.",
            "Atualize a configuração somente se o layout tiver sido homologado.",
        )
    return None


def _filter_ledger_mapping(
    records: list[LedgerRecord], accounts: list[AccountConfig]
) -> tuple[list[LedgerRecord], list[TechnicalError]]:
    keys = {(item.company, item.branch, item.ledger_account) for item in accounts}
    accepted, errors = [], []
    for record in records:
        if (record.company, record.branch, record.ledger_account) in keys:
            accepted.append(record)
        else:
            errors.append(
                _technical_error(
                    record.source_file,
                    "RELACIONAMENTO",
                    "CONTA_CONTABIL_NAO_CONFIGURADA",
                    f'A conta contábil "{record.ledger_account}" não está configurada.',
                    "Cadastre a conta ou corrija o registro.",
                    record.source_line,
                )
            )
    return accepted, errors


def _filter_bank_mapping(
    records: list[BankRecord], accounts: list[AccountConfig]
) -> tuple[list[BankRecord], list[TechnicalError]]:
    keys = {item.bank_key for item in accounts}
    accepted, errors = [], []
    for record in records:
        if (record.bank, record.agency, record.bank_account) in keys:
            accepted.append(record)
        else:
            errors.append(
                _technical_error(
                    record.source_file,
                    "RELACIONAMENTO",
                    "CONTA_BANCARIA_NAO_CONFIGURADA",
                    "Banco, agência e conta não correspondem à configuração.",
                    "Cadastre a conta ou corrija o nome do extrato.",
                    record.source_line,
                )
            )
    return accepted, errors


def _processed_file(
    descriptor: FileDescriptor, read_result: ReadResult, status: str
) -> ProcessedFile:
    return ProcessedFile(
        path=descriptor.path,
        file_type=descriptor.file_type,
        period=descriptor.period,
        sha256=descriptor.sha256,
        record_count=len(read_result.records),
        company=descriptor.company,
        bank=descriptor.bank,
        agency=descriptor.agency,
        account=descriptor.account,
        total_debit=read_result.total_debit,
        total_credit=read_result.total_credit,
        status=status,
        page_count=int(read_result.metadata.get("page_count", 0)),
        extraction_method=str(read_result.metadata.get("extraction_method", "")),
        valid_record_count=int(
            read_result.metadata.get("valid_record_count", len(read_result.records))
        ),
        rejected_record_count=int(read_result.metadata.get("rejected_record_count", 0)),
        warning_count=int(read_result.metadata.get("warning_count", len(read_result.warnings))),
        duration_seconds=Decimal(str(read_result.metadata.get("duration_seconds", "0"))),
    )


def _discovery_rejected_paths(base_dir: Path, errors: list[TechnicalError]) -> list[Path]:
    names = {error.file for error in errors if error.stage == "DESCOBERTA" and error.file}
    folders = (base_dir / "01_Entrada" / "Razao", base_dir / "01_Entrada" / "Extratos")
    paths: list[Path] = []
    for folder in folders:
        for name in names:
            candidate = folder / name
            if candidate.is_file():
                paths.append(candidate)
    return paths


def _discovery_rejected_file(path: Path, period: str) -> ProcessedFile:
    return ProcessedFile(
        path=path,
        file_type="RAZAO" if path.parent.name.casefold() == "razao" else "EXTRATO",
        period=period,
        sha256=file_sha256(path),
        record_count=0,
        status="REJEITADO",
    )


def _completeness_error(account: AccountConfig, code: str, occurred_at: datetime) -> TechnicalError:
    ledger_missing = code == "RAZAO_AUSENTE"
    return TechnicalError(
        file="",
        stage="VALIDACAO_COMPLETUDE",
        code=code,
        description=(
            f'Não há registros válidos de razão para a conta "{account.ledger_account}".'
            if ledger_missing
            else f'Não há registros válidos de extrato para "{account.bank_key}".'
        ),
        line=None,
        guidance=(
            "Inclua ou corrija o razão do período."
            if ledger_missing
            else "Inclua ou corrija o extrato do período."
        ),
        occurred_at=occurred_at,
    )


def _technical_error(
    file: str,
    stage: str,
    code: str,
    description: str,
    guidance: str,
    line: int | str | None = None,
) -> TechnicalError:
    return TechnicalError(
        file=file,
        stage=stage,
        code=code,
        description=description,
        line=line,
        guidance=guidance,
        occurred_at=datetime.now(UTC),
    )


def _output_company(
    accounts: list[AccountConfig], ledgers: list[LedgerRecord], descriptors: list[FileDescriptor]
) -> str:
    companies = {item.company for item in ledgers if item.company}
    companies.update(item.company for item in descriptors if item.company)
    if not companies:
        companies = {item.company for item in accounts}
    return next(iter(companies)) if len(companies) == 1 else "MULTIEMPRESA"


def _validate_period(period: str) -> None:
    if not re.fullmatch(r"\d{6}", period):
        raise FileValidationError('O período deve usar o formato "AAAAMM".')
    try:
        datetime.strptime(period, "%Y%m")
    except ValueError as exc:
        raise FileValidationError(f'O período "{period}" não representa um mês válido.') from exc


def _manifest_path(base_dir: Path) -> Path:
    return base_dir / "02_Processados" / "processed_hashes.json"


def _load_manifest(base_dir: Path) -> dict[str, Any]:
    path = _manifest_path(base_dir)
    if not path.exists():
        return {"version": 1, "files": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data.get("files"), list):
            raise ValueError
        return data
    except (json.JSONDecodeError, OSError, ValueError) as exc:
        raise FileValidationError(f'O manifesto de hashes "{path}" está corrompido.') from exc


def _hash_seen(manifest: dict[str, Any], sha256: str) -> bool:
    return any(item.get("sha256") == sha256 for item in manifest["files"])


def _append_manifest(
    base_dir: Path,
    manifest: dict[str, Any],
    archived: list[tuple[FileDescriptor, Path]],
    period: str,
    executed_at: datetime,
    reprocessing: bool,
) -> None:
    for descriptor, destination in archived:
        manifest["files"].append(
            {
                "sha256": descriptor.sha256,
                "original_name": descriptor.path.name,
                "archived_path": str(destination.relative_to(base_dir)),
                "period": period,
                "processed_at": executed_at.isoformat(),
                "reprocessing": reprocessing,
            }
        )
    path = _manifest_path(base_dir)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def _versioned_path(path: Path, executed_at: datetime) -> Path:
    if not path.exists():
        return path
    return path.with_name(f"{path.stem}_REPROC_{_timestamp(executed_at)}{path.suffix}")


def _timestamp(value: datetime) -> str:
    return value.strftime("%Y%m%d_%H%M%S_%f")


def _execution_logger(path: Path) -> logging.Logger:
    logger = logging.getLogger(f"conciliacao.{path.stem}.{id(path)}")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    handler = logging.FileHandler(path, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s"))
    handler.addFilter(_SensitiveDataFilter())
    logger.addHandler(handler)
    return logger


def _close_logger(logger: logging.Logger) -> None:
    for handler in list(logger.handlers):
        handler.close()
        logger.removeHandler(handler)


class _SensitiveDataFilter(logging.Filter):
    """Remove contas completas sem alterar arquivos, relatórios ou manifesto formal."""

    _statement_name = re.compile(
        r"(EXTRATO_[^\\/\s]+_[^_\\/\s]+_)([^_\\/\s]+)(_\d{6}\.(?:CSV|XLSX|OFX|PDF))",
        re.IGNORECASE,
    )

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        record.msg = self._statement_name.sub(
            lambda match: f"{match.group(1)}*****{match.group(2)[-4:]}{match.group(3)}",
            message,
        )
        record.args = ()
        return True
