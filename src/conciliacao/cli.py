"""Interface de linha de comando para usuários e automação BAT."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from conciliacao.errors import ConciliacaoError
from conciliacao.processing import ReconciliationProcessor, initialize_workspace


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="conciliacao", description="Conciliação bancária auditável por arquivos"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    init = subparsers.add_parser("init", help="criar pastas e template de configuração")
    init.add_argument("--base-dir", type=Path, default=Path.cwd())
    run = subparsers.add_parser("run", help="processar uma competência mensal")
    run.add_argument("--base-dir", type=Path, default=Path.cwd())
    run.add_argument("--periodo", required=True, help="competência no formato AAAAMM")
    run.add_argument(
        "--reprocessar",
        action="store_true",
        help="autorizar explicitamente hashes já processados",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "init":
            configuration = initialize_workspace(args.base_dir)
            print(f"Estrutura criada. Configure as contas em: {configuration}")
            return 0
        print("Carregando configuração...")
        print("Localizando e validando arquivos...")
        outcome = ReconciliationProcessor(args.base_dir).run(
            args.periodo, allow_reprocessing=args.reprocessar
        )
        print("Executando conciliação e gerando evidências...")
        print(f"Processamento concluído. Relatório: {outcome.report_path}")
        print(f"Log: {outcome.log_path}")
        if outcome.errors:
            print(f"Atenção: {len(outcome.errors)} erro(s)/alerta(s) detalhados no relatório.")
        return 0
    except ConciliacaoError as exc:
        print(f"Falha: {exc}")
        return 2
