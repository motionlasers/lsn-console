from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "exports" / "LSN_Firmware_Integration_Handoff.pdf"
OUT = ROOT / ".agents" / "outputs" / "firmware-handoff-pages"
OUT.mkdir(parents=True, exist_ok=True)

document = fitz.open(PDF)
print(f"pages={document.page_count}")
for index, page in enumerate(document):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
    output = OUT / f"page-{index + 1}.png"
    pixmap.save(output)
    print(output)