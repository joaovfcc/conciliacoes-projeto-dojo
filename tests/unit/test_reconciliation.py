from datetime import date
from decimal import Decimal

from conciliacao.models import AccountConfig, BankRecord, LedgerRecord, Status
from conciliacao.reconciliation import ReconciliationEngine

CONFIG = AccountConfig(
    company="SPREAD",
    branch="MATRIZ",
    ledger_account="1.1.1.01.001",
    description="Banco Itaú",
    bank="ITAU",
    agency="1234",
    bank_account="567890",
    accepted_format="OFX",
    date_tolerance=2,
    value_tolerance=Decimal("0.01"),
    primary_rule="DOC_VALOR_DATA",
    active=True,
)


def ledger(
    record_id="L1",
    *,
    day=28,
    document="15487",
    value="-1500.00",
    source_line=2,
):
    return LedgerRecord(
        record_id=record_id,
        company="SPREAD",
        branch="MATRIZ",
        ledger_account=CONFIG.ledger_account,
        date=date(2026, 7, day),
        document=document,
        history="PAGAMENTO FORNECEDOR",
        value=Decimal(value),
        nature="DEBITO",
        source_id=record_id,
        source_file="RAZAO_SPREAD_MATRIZ_202607.xlsx",
        source_line=source_line,
    )


def bank(
    record_id="B1",
    *,
    day=28,
    document="15487",
    value="-1500.00",
    source_line=2,
):
    return BankRecord(
        record_id=record_id,
        bank="ITAU",
        agency="1234",
        bank_account="567890",
        date=date(2026, 7, day),
        document=document,
        history="PAGTO FORNECEDOR",
        value=Decimal(value),
        nature="DEBITO",
        source_id=record_id,
        source_file="EXTRATO_ITAU_1234_567890_202607.ofx",
        source_line=source_line,
    )


def reconcile(ledgers, banks):
    return ReconciliationEngine().reconcile(ledgers, banks, CONFIG, "202607")


def test_exact_match_has_auditable_pair_and_zero_difference():
    result = reconcile([ledger()], [bank()])[0]

    assert result.status is Status.CONCILIADO_EXATO
    assert result.ledger.record_id == "L1"
    assert result.bank.record_id == "B1"
    assert result.value_difference == Decimal("0.00")
    assert result.date_difference == 0
    assert result.rule == "REGRA_1_CORRESPONDENCIA_EXATA"


def test_document_and_value_match_inside_date_tolerance():
    result = reconcile([ledger(day=28)], [bank(day=30)])[0]

    assert result.status is Status.CONCILIADO_TOLERANCIA_DATA
    assert result.date_difference == 2


def test_missing_bank_document_matches_only_unique_value_and_date():
    result = reconcile([ledger(document="ABC")], [bank(document="")])[0]

    assert result.status is Status.CONCILIADO_VALOR_DATA


def test_multiple_value_date_candidates_are_never_chosen_arbitrarily():
    results = reconcile(
        [ledger(document="ABC")],
        [
            bank("B1", document="", day=28, source_line=2),
            bank("B2", document="", day=29, source_line=3),
        ],
    )

    ambiguous = [item for item in results if item.status is Status.MULTIPLAS_CORRESPONDENCIAS]
    assert len(ambiguous) == 1
    assert {candidate.record_id for candidate in ambiguous[0].candidates} == {"B1", "B2"}
    assert all(item.bank is None for item in ambiguous)


def test_same_document_and_near_date_with_different_value_is_divergence():
    result = reconcile([ledger(value="-1500")], [bank(value="-1450", day=29)])[0]

    assert result.status is Status.DIVERGENCIA_VALOR
    assert result.value_difference == Decimal("-50.00")


def test_same_document_and_value_outside_tolerance_is_date_divergence():
    result = reconcile([ledger(day=20)], [bank(day=28)])[0]

    assert result.status is Status.DIVERGENCIA_DATA
    assert result.date_difference == 8


def test_unmatched_items_are_classified_on_both_sides():
    results = reconcile(
        [ledger(document="LEDGER", value="100")],
        [bank(document="BANK", value="200")],
    )

    assert {item.status for item in results} == {
        Status.RAZAO_SEM_EXTRATO,
        Status.EXTRATO_SEM_RAZAO,
    }


def test_source_record_is_never_reused():
    results = reconcile(
        [ledger("L1"), ledger("L2", document="999", source_line=3)],
        [bank("B1")],
    )

    assert sum(item.bank is not None for item in results) == 1
    assert any(item.status is Status.RAZAO_SEM_EXTRATO for item in results)


def test_duplicate_source_signatures_are_flagged_and_not_auto_matched():
    results = reconcile(
        [ledger("L1", source_line=2), ledger("L2", source_line=3)],
        [bank("B1")],
    )

    duplicates = [item for item in results if item.status is Status.POSSIVEL_DUPLICIDADE]
    assert len(duplicates) == 2
    assert not any(item.status is Status.CONCILIADO_EXATO for item in results)
