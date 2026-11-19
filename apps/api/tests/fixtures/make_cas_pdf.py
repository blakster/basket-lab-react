"""Generate a non-personal CAMS-layout demo (optional dependency: reportlab).

Run from apps/api: .venv/bin/python tests/fixtures/make_cas_pdf.py
PDF password: DEMO. Output is beside this script.
"""

from pathlib import Path

from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.pdfgen.canvas import Canvas


def generate(path):
    canvas = Canvas(str(path), pagesize=(700, 842), invariant=1,
                    encrypt=StandardEncryption("DEMO", ownerPassword="DEMO-OWNER"))
    canvas.setFont("Helvetica", 9)
    def line(y, text):
        canvas.drawString(30, y, text)
    line(810, "CAMSCASWS")
    line(790, "Consolidated Account Statement")
    line(770, "01-Jan-2024 To 31-Mar-2024")
    line(750, "Email Id: demo@example.invalid")
    line(735, "Synthetic Investor")
    line(720, "1 Fictional Street")
    line(705, "Mobile: 9000000000")
    # Public scheme identifiers allow casparser's bundled ISIN lookup to resolve.
    for y, folio, rta, isin in [(660, "100001", "CAMS", "INF179K01319"),
                                (410, "200002", "KFINTECH", "INF179K01327")]:
        line(y, "Example Mutual Fund")
        line(y-20, f"Folio No: {folio}")
        line(y-40, f"DEMO-Synthetic Equity Direct Growth ISIN: {isin} Registrar: {rta}")
        line(y-60, "Opening Unit Balance: 0.000")
        canvas.drawString(30, y-85, "Date")
        canvas.drawString(110, y-85, "Transaction")
        for x, label in [(410, "Amount"), (490, "Units"), (570, "Price"), (660, "Unit")]:
            canvas.drawRightString(x, y-85, label)
        canvas.drawRightString(660, y-95, "Balance")
        canvas.drawString(30, y-120, "01-Jan-2024")
        canvas.drawString(110, y-120, "SIP Purchase")
        for x, value in [(410, "1000.00"), (490, "10.000"), (570, "100.00"), (660, "10.000")]:
            canvas.drawRightString(x, y-120, value)
        line(y-145, "Closing Unit Balance: 10.000")
        line(y-165, "NAV on 31-Mar-2024: INR 110.00")
        line(y-185, "Valuation on 31-Mar-2024: INR 1100.00")
    canvas.save()


if __name__ == "__main__":
    generate(Path(__file__).with_name("synthetic_cas.pdf"))
