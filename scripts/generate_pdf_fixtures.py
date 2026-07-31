"""Gera PDFs bancários sintéticos usados pelos testes de integração."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "pdf-statements"

HEADER = [
    "BANCO ITAU - EXTRATO CONTA CORRENTE",
    "TITULAR: EMPRESA DEMONSTRACAO",
    "AGENCIA: 1234 CONTA: 567890",
    "PERIODO: 01/07/2026 A 31/07/2026",
    "DATA DESCRICAO DOCUMENTO VALOR SALDO",
]


def _text_pdf(path: Path, pages: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    document = canvas.Canvas(str(path), pagesize=A4)
    for lines in pages:
        y = A4[1] - 55
        document.setFont("Helvetica", 10)
        for line in lines:
            document.drawString(45, y, line)
            y -= 18
        document.showPage()
    document.save()


def _scanned_pdf(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (1654, 2339), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=22)
    y = 90
    for line in lines:
        draw.text((90, y), line, fill="black", font=font)
        y += 48
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    document = canvas.Canvas(str(path), pagesize=A4)
    document.drawImage(ImageReader(buffer), 0, 0, width=A4[0], height=A4[1])
    document.showPage()
    document.save()


def _scanned_multi_page_pdf(path: Path, pages: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    document = canvas.Canvas(str(path), pagesize=A4)
    for lines in pages:
        image = Image.new("RGB", (1654, 2339), "white")
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default(size=22)
        y = 90
        for line in lines:
            draw.text((90, y), line, fill="black", font=font)
            y += 48
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        buffer.seek(0)
        document.drawImage(ImageReader(buffer), 0, 0, width=A4[0], height=A4[1])
        document.showPage()
    document.save()


def _protected_pdf(path: Path) -> None:
    plain = BytesIO()
    document = canvas.Canvas(plain, pagesize=A4)
    document.drawString(45, A4[1] - 55, "EXTRATO SINTETICO PROTEGIDO")
    document.save()
    plain.seek(0)
    writer = PdfWriter()
    for page in PdfReader(plain).pages:
        writer.add_page(page)
    writer.encrypt("senha-ficticia")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as stream:
        writer.write(stream)


def generate() -> None:
    transaction_lines = [
        *HEADER,
        "SALDO ANTERIOR 1.000,00 C",
        "05/07 PAGAMENTO FORNECEDOR 001 100,00 D 900,00 C",
        "COMPLEMENTO DA DESCRICAO",
        "06/07 PIX RECEBIDO 002 250,00 C 1.150,00 C",
        "SALDO FINAL 1.150,00 C",
        "Documento gerado exclusivamente para testes.",
    ]
    _text_pdf(
        ROOT / "text-based" / "EXTRATO_ITAU_1234_567890_202607.pdf",
        [transaction_lines],
    )
    _text_pdf(
        ROOT / "multi-page" / "EXTRATO_ITAU_1234_567890_202607.pdf",
        [
            [
                *HEADER,
                "SALDO ANTERIOR 1.000,00 C",
                "05/07 PAGAMENTO FORNECEDOR 001 100,00 D 900,00 C",
                "COMPLEMENTO DA DESCRICAO",
                "Pagina 1 de 2",
            ],
            [
                *HEADER,
                "06/07 PIX RECEBIDO 002 250,00 C 1.150,00 C",
                "07/07 TARIFA BANCARIA 003 40,00 D 1.110,00 C",
                "SALDO FINAL 1.110,00 C",
                "Pagina 2 de 2",
            ],
        ],
    )
    _scanned_pdf(
        ROOT / "scanned" / "EXTRATO_ITAU_1234_567890_202607.pdf",
        transaction_lines,
    )
    _scanned_multi_page_pdf(
        ROOT / "scanned" / "EXTRATO_ITAU_1234_888888_202607.pdf",
        [
            [*HEADER, "05/07 PAGAMENTO TESTE 001 100,00 D 900,00 C"],
            [*HEADER, "06/07 PIX TESTE 002 250,00 C 1.150,00 C"],
        ],
    )
    _text_pdf(
        ROOT / "unsupported-layout" / "EXTRATO_OUTRO_1234_567890_202607.pdf",
        [["RELATORIO FINANCEIRO SINTETICO", "Linha sem estrutura de movimentacao 100,00"]],
    )
    invalid = ROOT / "invalid"
    invalid.mkdir(parents=True, exist_ok=True)
    (invalid / "EXTRATO_ITAU_1234_567890_202607.pdf").write_bytes(
        b"%PDF-1.7\nconteudo propositalmente corrompido"
    )
    _protected_pdf(invalid / "EXTRATO_ITAU_1234_999999_202607.pdf")
    writer = PdfWriter()
    with (invalid / "EXTRATO_ITAU_1234_000000_202607.pdf").open("wb") as stream:
        writer.write(stream)


if __name__ == "__main__":
    generate()
