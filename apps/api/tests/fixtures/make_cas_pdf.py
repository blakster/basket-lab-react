"""Generate a non-personal CAMS-layout demo (optional dependency: reportlab).

Run from apps/api: .venv/bin/python tests/fixtures/make_cas_pdf.py
PDF password: DEMO. Output is beside this script.
NAVs are the real historical NAVs of the two HDFC schemes so returns reconcile
with live NAV history. Amounts are ₹2,000 SIPs; units = amount / NAV.
"""

from pathlib import Path

from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.pdfgen.canvas import Canvas

# (folio, rta, isin, [(date, description, amount, units, nav, balance), ...], close_nav)
SCHEMES = [
    ("100001", "CAMS", "INF179K01319", [
        ("01-Jan-2024", "SIP Purchase", 2000.00, 74.809, 26.734, 74.809),
        ("01-Feb-2024", "SIP Purchase", 2000.00, 74.182, 26.962, 148.991),
        ("01-Mar-2024", "SIP Purchase", 2000.00, 73.790, 27.103, 222.781),
    ], 27.251),
    ("200002", "KFINTECH", "INF179K01327", [
        ("01-Jan-2024", "SIP Purchase", 2000.00, 104.941, 19.058, 104.941),
        ("01-Feb-2024", "SIP Purchase", 2000.00, 104.054, 19.221, 208.995),
        ("01-Mar-2024", "SIP Purchase", 2000.00, 103.515, 19.321, 312.510),
        ("15-Mar-2024", "Redemption", 546.97, -28.250, 19.362, 284.260),
    ], 19.427),
]


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
    for y, (folio, rta, isin, rows, close_nav) in zip([660, 400], SCHEMES):
        line(y, "HDFC Mutual Fund")
        line(y - 20, f"Folio No: {folio}")
        line(y - 40, f"DEMO-Synthetic Equity Direct Growth ISIN: {isin} Registrar: {rta}")
        line(y - 60, "Opening Unit Balance: 0.000")
        canvas.drawString(30, y - 85, "Date")
        canvas.drawString(110, y - 85, "Transaction")
        for x, label in [(410, "Amount"), (490, "Units"), (570, "Price"), (660, "Unit")]:
            canvas.drawRightString(x, y - 85, label)
        canvas.drawRightString(660, y - 95, "Balance")
        row_y = y - 115
        for date, desc, amount, units, nav, balance in rows:
            canvas.drawString(30, row_y, date)
            canvas.drawString(110, row_y, desc)
            for x, value in [(410, f"{amount:.2f}"), (490, f"{units:.3f}"),
                             (570, f"{nav:.3f}"), (660, f"{balance:.3f}")]:
                canvas.drawRightString(x, row_y, value)
            row_y -= 20
        close_units = rows[-1][5]
        line(row_y - 10, f"Closing Unit Balance: {close_units:.3f}")
        line(row_y - 30, "NAV on 31-Mar-2024: INR 27.251" if folio == "100001" else "NAV on 31-Mar-2024: INR 19.427")
        line(row_y - 50, f"Valuation on 31-Mar-2024: INR {close_units * close_nav:,.2f}")
    canvas.save()


if __name__ == "__main__":
    generate(Path(__file__).with_name("synthetic_cas.pdf"))
