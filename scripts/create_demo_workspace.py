"""Cria dados totalmente fictícios para uma demonstração local do fluxo."""

from __future__ import annotations

import argparse
from pathlib import Path

from openpyxl import load_workbook

from conciliacao.processing import initialize_workspace


def create_demo(base_dir: Path, period: str) -> None:
    base_dir = Path(base_dir).resolve()
    config_path = initialize_workspace(base_dir)
    workbook = load_workbook(config_path)
    accounts = workbook["Contas"]
    if accounts.max_row == 1:
        accounts.append(
            [
                "DEMO",
                "MATRIZ",
                "1.1.1.01.001",
                "Banco Demonstração",
                "BANCO",
                "1234",
                "567890",
                "CSV,XLSX,OFX",
                2,
                "0,01",
                "DOC_VALOR_DATA",
                "SIM",
                "Usuário Demo",
            ]
        )
        workbook.save(config_path)
    year, month = period[:4], period[4:]
    ledger = base_dir / "01_Entrada" / "Razao" / f"RAZAO_DEMO_MATRIZ_{period}.csv"
    statement = base_dir / "01_Entrada" / "Extratos" / f"EXTRATO_BANCO_1234_567890_{period}.csv"
    if ledger.exists() or statement.exists():
        raise FileExistsError("A entrada demo já existe; use uma pasta vazia.")
    ledger.write_text(
        "Empresa;Filial;Conta contábil;Data;Documento;Histórico;Débito;Crédito;Identificador\n"
        f"DEMO;MATRIZ;1.1.1.01.001;05/{month}/{year};001;PAGAMENTO FICTICIO;100;0;L1\n"
        f"DEMO;MATRIZ;1.1.1.01.001;06/{month}/{year};002;RECEBIMENTO FICTICIO;0;250;L2\n",
        encoding="utf-8",
    )
    statement.write_text(
        "Data;Documento;Histórico;Valor;Identificador bancário\n"
        f"05/{month}/{year};001;PAGAMENTO FICTICIO;-100;B1\n"
        f"06/{month}/{year};002;RECEBIMENTO FICTICIO;250;B2\n"
        f"07/{month}/{year};003;TARIFA FICTICIA;-40;B3\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-dir", type=Path, required=True)
    parser.add_argument("--periodo", default="202607")
    args = parser.parse_args()
    create_demo(args.base_dir, args.periodo)
    print(f"Workspace demo criado em {args.base_dir.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
