from pathlib import Path

import pymupdf


ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "exports" / "LSN_EtherNetIP_Discovery_and_Connection_Steps.pdf"
OUT = ROOT / ".agents" / "outputs" / "ethernetip-discovery-pages"
OUT.mkdir(parents=True, exist_ok=True)

document = pymupdf.open(PDF)
print(f"pages={document.page_count}")
for index, page in enumerate(document):
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
    output = OUT / f"page-{index + 1}.png"
    pixmap.save(output)
    print(output)