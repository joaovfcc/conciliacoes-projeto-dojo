from conciliacao.cli import main


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
