"""Motor conservador de conciliação um-para-um."""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Iterable
from decimal import Decimal
from hashlib import sha1

from conciliacao.models import (
    AccountConfig,
    BankRecord,
    LedgerRecord,
    ReconciliationResult,
    Status,
)


class ReconciliationEngine:
    """Aplica as regras do PRD em prioridade, sem reaproveitar registros."""

    def reconcile(
        self,
        ledgers: Iterable[LedgerRecord],
        banks: Iterable[BankRecord],
        config: AccountConfig,
        period: str,
    ) -> list[ReconciliationResult]:
        ledger_items = list(ledgers)
        bank_items = list(banks)
        results: list[ReconciliationResult] = []
        used_ledgers: set[str] = set()
        used_banks: set[str] = set()

        self._flag_duplicates(
            ledger_items, bank_items, config, period, results, used_ledgers, used_banks
        )

        stages: tuple[tuple[Status, str, Callable[[LedgerRecord, BankRecord], bool]], ...] = (
            (
                Status.CONCILIADO_EXATO,
                "REGRA_1_CORRESPONDENCIA_EXATA",
                lambda left, right: (
                    bool(left.document)
                    and left.document == right.document
                    and left.date == right.date
                    and self._same_value(left.value, right.value, config.value_tolerance)
                ),
            ),
            (
                Status.CONCILIADO_TOLERANCIA_DATA,
                "REGRA_2_TOLERANCIA_DATA",
                lambda left, right: (
                    bool(left.document)
                    and left.document == right.document
                    and 0 < abs((left.date - right.date).days) <= config.date_tolerance
                    and self._same_value(left.value, right.value, config.value_tolerance)
                ),
            ),
            (
                Status.CONCILIADO_VALOR_DATA,
                "REGRA_3_VALOR_DATA_SEM_DOCUMENTO",
                lambda left, right: (
                    (not right.document or not left.document)
                    and abs((left.date - right.date).days) <= config.date_tolerance
                    and self._same_value(left.value, right.value, config.value_tolerance)
                ),
            ),
            (
                Status.DIVERGENCIA_VALOR,
                "REGRA_4_DIVERGENCIA_VALOR",
                lambda left, right: (
                    bool(left.document)
                    and left.document == right.document
                    and abs((left.date - right.date).days) <= config.date_tolerance
                    and not self._same_value(left.value, right.value, config.value_tolerance)
                ),
            ),
            (
                Status.DIVERGENCIA_DATA,
                "REGRA_5_DIVERGENCIA_DATA",
                lambda left, right: (
                    bool(left.document)
                    and left.document == right.document
                    and abs((left.date - right.date).days) > config.date_tolerance
                    and self._same_value(left.value, right.value, config.value_tolerance)
                ),
            ),
        )

        for status, rule, predicate in stages:
            for ledger in ledger_items:
                if ledger.record_id in used_ledgers:
                    continue
                candidates = [
                    bank
                    for bank in bank_items
                    if bank.record_id not in used_banks and predicate(ledger, bank)
                ]
                if len(candidates) == 1:
                    selected = candidates[0]
                    used_ledgers.add(ledger.record_id)
                    used_banks.add(selected.record_id)
                    results.append(self._result(period, status, rule, config, ledger, selected))
                elif len(candidates) > 1:
                    used_ledgers.add(ledger.record_id)
                    results.append(
                        self._result(
                            period,
                            Status.MULTIPLAS_CORRESPONDENCIAS,
                            "REGRA_8_AMBIGUIDADE",
                            config,
                            ledger,
                            candidates=tuple(candidates),
                        )
                    )

        for ledger in ledger_items:
            if ledger.record_id not in used_ledgers:
                results.append(
                    self._result(
                        period,
                        Status.RAZAO_SEM_EXTRATO,
                        "REGRA_6_RAZAO_SEM_EXTRATO",
                        config,
                        ledger,
                    )
                )
        for bank in bank_items:
            if bank.record_id not in used_banks:
                results.append(
                    self._result(
                        period,
                        Status.EXTRATO_SEM_RAZAO,
                        "REGRA_7_EXTRATO_SEM_RAZAO",
                        config,
                        bank=bank,
                    )
                )
        return results

    @staticmethod
    def _same_value(left: Decimal, right: Decimal, tolerance: Decimal) -> bool:
        return abs(left - right) <= tolerance

    def _flag_duplicates(
        self,
        ledgers: list[LedgerRecord],
        banks: list[BankRecord],
        config: AccountConfig,
        period: str,
        results: list[ReconciliationResult],
        used_ledgers: set[str],
        used_banks: set[str],
    ) -> None:
        ledger_keys = Counter(
            (item.ledger_account, item.date, item.document, item.value) for item in ledgers
        )
        bank_keys = Counter(
            (item.bank, item.agency, item.bank_account, item.date, item.document, item.value)
            for item in banks
        )
        for ledger in ledgers:
            key = (ledger.ledger_account, ledger.date, ledger.document, ledger.value)
            if ledger_keys[key] > 1:
                used_ledgers.add(ledger.record_id)
                results.append(
                    self._result(
                        period,
                        Status.POSSIVEL_DUPLICIDADE,
                        "REGRA_9_DUPLICIDADE_RAZAO",
                        config,
                        ledger,
                    )
                )
        for bank in banks:
            key = (bank.bank, bank.agency, bank.bank_account, bank.date, bank.document, bank.value)
            if bank_keys[key] > 1:
                used_banks.add(bank.record_id)
                results.append(
                    self._result(
                        period,
                        Status.POSSIVEL_DUPLICIDADE,
                        "REGRA_9_DUPLICIDADE_EXTRATO",
                        config,
                        bank=bank,
                    )
                )

    def _result(
        self,
        period: str,
        status: Status,
        rule: str,
        config: AccountConfig,
        ledger: LedgerRecord | None = None,
        bank: BankRecord | None = None,
        candidates: tuple[BankRecord, ...] = (),
    ) -> ReconciliationResult:
        difference = ledger.value - bank.value if ledger and bank else None
        date_difference = abs((ledger.date - bank.date).days) if ledger and bank else None
        bank_code = (bank.bank if bank else config.bank)[:10]
        source_key = "|".join(
            [
                status.value,
                ledger.record_id if ledger else "",
                bank.record_id if bank else "",
                ",".join(candidate.record_id for candidate in candidates),
            ]
        )
        suffix = sha1(source_key.encode("utf-8"), usedforsecurity=False).hexdigest()[:10].upper()
        prefix = "CON" if status.value.startswith("CONCILIADO") else "DIV"
        result_id = f"{prefix}-{period[2:]}-{bank_code}-{suffix}"
        reasons = {
            Status.CONCILIADO_EXATO: "Data, documento e valor correspondem.",
            Status.CONCILIADO_TOLERANCIA_DATA: (
                "Documento e valor correspondem dentro da tolerância de data."
            ),
            Status.CONCILIADO_VALOR_DATA: (
                "Correspondência única por valor e data sem documento bancário."
            ),
            Status.DIVERGENCIA_VALOR: "Documento compatível, mas o valor excede a tolerância.",
            Status.DIVERGENCIA_DATA: (
                "Documento e valor compatíveis, mas a data excede a tolerância."
            ),
            Status.RAZAO_SEM_EXTRATO: "Nenhum movimento bancário correspondente foi encontrado.",
            Status.EXTRATO_SEM_RAZAO: "Nenhum lançamento contábil correspondente foi encontrado.",
            Status.MULTIPLAS_CORRESPONDENCIAS: (
                "Há mais de um candidato; nenhuma escolha automática foi feita."
            ),
            Status.POSSIVEL_DUPLICIDADE: (
                "A mesma combinação de campos aparece mais de uma vez na origem."
            ),
        }
        return ReconciliationResult(
            result_id=result_id,
            status=status,
            rule=rule,
            reason=reasons[status],
            ledger=ledger,
            bank=bank,
            candidates=candidates,
            value_difference=difference,
            date_difference=date_difference,
            tolerance_days=config.date_tolerance,
            tolerance_value=config.value_tolerance,
        )
