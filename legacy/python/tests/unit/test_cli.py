import logging

from conciliacao.cli import main
from conciliacao.processing import _SensitiveDataFilter


def test_cli_init_creates_structure_and_returns_success(tmp_path, capsys):
    exit_code = main(["init", "--base-dir", str(tmp_path)])

    assert exit_code == 0
    assert (tmp_path / "05_Configuracao" / "CONFIGURACAO_CONTAS.xlsx").exists()
    assert "Estrutura criada" in capsys.readouterr().out


def test_cli_returns_actionable_error_without_configured_accounts(tmp_path, capsys):
    main(["init", "--base-dir", str(tmp_path)])

    exit_code = main(["run", "--base-dir", str(tmp_path), "--periodo", "202607"])

    assert exit_code == 2
    assert "não possui nenhum relacionamento" in capsys.readouterr().out


def test_log_filter_masks_hyphenated_account_in_reprocessed_filename():
    record = logging.LogRecord(
        "test",
        logging.INFO,
        "",
        0,
        "EXTRATO_ITAU_0191_26775-6_202602_REPROC_20260731_193648_206014.pdf",
        (),
        None,
    )

    _SensitiveDataFilter().filter(record)

    assert "26775-6" not in record.getMessage()
    assert "*****7756" in record.getMessage()
    assert "REPROC_20260731_193648_206014" in record.getMessage()
