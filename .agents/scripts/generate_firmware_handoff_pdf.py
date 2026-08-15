from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "exports" / "LSN_Firmware_Integration_Handoff.pdf"
LSN_LOGO = ROOT / "attached_assets" / "LSN-Industrial-transparent_1786661922957.png"
SABER_LOGO = ROOT / "attached_assets" / "Saber-Industrial-Applications-Logo_1786661980178.png"

NAVY = colors.HexColor("#071923")
NAVY_2 = colors.HexColor("#0B2735")
CYAN = colors.HexColor("#22D3EE")
CYAN_DARK = colors.HexColor("#0E7490")
PALE_CYAN = colors.HexColor("#E8F9FC")
INK = colors.HexColor("#12212A")
MUTED = colors.HexColor("#52636D")
LINE = colors.HexColor("#CAD7DC")
PALE = colors.HexColor("#F3F7F8")
AMBER = colors.HexColor("#D97706")
PALE_AMBER = colors.HexColor("#FFF7E8")
WHITE = colors.white


class HandoffDocument(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=letter,
            rightMargin=0.62 * inch,
            leftMargin=0.62 * inch,
            topMargin=0.68 * inch,
            bottomMargin=0.58 * inch,
            title="LSN Engineering Console — Physical Firmware Integration Handoff",
            author="Saber Industrial Applications",
            subject="Information request for ESP32 / WT32-ETH01 physical integration",
        )
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="body",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates(
            [
                PageTemplate(id="content", frames=[frame], onPage=self.draw_page),
            ]
        )

    def draw_page(self, canvas, doc):
        width, height = letter
        if doc.page == 1:
            canvas.saveState()
            canvas.setFillColor(NAVY)
            canvas.rect(0, 0, width, height, stroke=0, fill=1)
            canvas.setFillColor(CYAN)
            canvas.rect(0, 0, 0.12 * inch, height, stroke=0, fill=1)
            canvas.setFillColor(colors.HexColor("#0A3444"))
            canvas.circle(width - 0.4 * inch, height - 0.5 * inch, 1.9 * inch, stroke=0, fill=1)
            canvas.setFillColor(colors.HexColor("#092532"))
            canvas.circle(width - 0.55 * inch, 0.35 * inch, 1.35 * inch, stroke=0, fill=1)
            canvas.restoreState()
            return

        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(0.62 * inch, height - 0.43 * inch, width - 0.62 * inch, height - 0.43 * inch)
        canvas.setFont("Helvetica-Bold", 7.5)
        canvas.setFillColor(CYAN_DARK)
        canvas.drawString(0.62 * inch, height - 0.31 * inch, "LSN ENGINEERING CONSOLE")
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(width - 0.62 * inch, height - 0.31 * inch, "PHYSICAL FIRMWARE INTEGRATION")
        canvas.setStrokeColor(LINE)
        canvas.line(0.62 * inch, 0.4 * inch, width - 0.62 * inch, 0.4 * inch)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(0.62 * inch, 0.25 * inch, "Saber Industrial Applications  •  Integration information request")
        canvas.drawRightString(width - 0.62 * inch, 0.25 * inch, f"Page {doc.page}")
        canvas.restoreState()


styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        name="CoverKicker",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13,
        textColor=CYAN,
        spaceAfter=10,
        tracking=1.4,
    )
)
styles.add(
    ParagraphStyle(
        name="CoverTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=29,
        leading=33,
        alignment=TA_LEFT,
        textColor=WHITE,
        spaceAfter=14,
    )
)
styles.add(
    ParagraphStyle(
        name="CoverSub",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=12,
        leading=18,
        textColor=colors.HexColor("#C7E6ED"),
        spaceAfter=14,
    )
)
styles.add(
    ParagraphStyle(
        name="CoverStatus",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=15,
        textColor=WHITE,
    )
)
styles.add(
    ParagraphStyle(
        name="H1x",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=NAVY,
        spaceAfter=10,
    )
)
styles.add(
    ParagraphStyle(
        name="H2x",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=11.5,
        leading=14,
        textColor=CYAN_DARK,
        spaceBefore=8,
        spaceAfter=4,
    )
)
styles.add(
    ParagraphStyle(
        name="Bodyx",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=9.2,
        leading=13.2,
        textColor=INK,
        spaceAfter=5,
    )
)
styles.add(
    ParagraphStyle(
        name="Smallx",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=8.3,
        leading=11.5,
        textColor=MUTED,
    )
)
styles.add(
    ParagraphStyle(
        name="Bulletx",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=8.9,
        leading=12.3,
        leftIndent=13,
        firstLineIndent=-7,
        bulletIndent=0,
        textColor=INK,
        spaceAfter=2.5,
    )
)
styles.add(
    ParagraphStyle(
        name="CalloutTitle",
        parent=styles["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13,
        textColor=NAVY,
        spaceAfter=3,
    )
)
styles.add(
    ParagraphStyle(
        name="CalloutBody",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=8.8,
        leading=12.4,
        textColor=INK,
    )
)
styles.add(
    ParagraphStyle(
        name="SectionNum",
        parent=styles["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=17,
        alignment=TA_CENTER,
        textColor=WHITE,
    )
)


def p(text: str, style: str = "Bodyx") -> Paragraph:
    return Paragraph(text, styles[style])


def bullet(text: str) -> Paragraph:
    return Paragraph(f"•&nbsp;&nbsp;{text}", styles["Bulletx"])


def callout(title: str, body: str, color=PALE_CYAN, accent=CYAN_DARK):
    content = [
        p(title, "CalloutTitle"),
        p(body, "CalloutBody"),
    ]
    table = Table([[content]], colWidths=[7.08 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), color),
                ("BOX", (0, 0), (-1, -1), 0.7, accent),
                ("LINEBEFORE", (0, 0), (0, -1), 4, accent),
                ("LEFTPADDING", (0, 0), (-1, -1), 14),
                ("RIGHTPADDING", (0, 0), (-1, -1), 14),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return table


def numbered_section(number: int, title: str, items: list[str]):
    badge = Table(
        [[p(str(number), "SectionNum")]],
        colWidths=[0.34 * inch],
        rowHeights=[0.34 * inch],
    )
    badge.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CYAN_DARK),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BOX", (0, 0), (-1, -1), 0, CYAN_DARK),
            ]
        )
    )
    title_block = [p(title, "H2x")] + [bullet(item) for item in items]
    block = Table([[badge, title_block]], colWidths=[0.48 * inch, 6.6 * inch])
    block.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return KeepTogether(block)


story = []

# Cover
story.append(Spacer(1, 0.28 * inch))
logo_table = Table(
    [
        [
            Image(str(LSN_LOGO), width=0.82 * inch, height=0.82 * inch),
            Image(str(SABER_LOGO), width=1.65 * inch, height=0.46 * inch),
        ]
    ],
    colWidths=[4.95 * inch, 2.1 * inch],
)
logo_table.setStyle(
    TableStyle(
        [
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]
    )
)
story.append(logo_table)
story.append(Spacer(1, 0.9 * inch))
story.append(p("INTEGRATION INFORMATION REQUEST", "CoverKicker"))
story.append(p("LSN Engineering Console", "CoverTitle"))
story.append(p("Physical Firmware Integration<br/>ESP32 / WT32-ETH01", "CoverTitle"))
story.append(
    p(
        "A concise handoff explaining the Console’s current status, the firmware information needed, "
        "and how physical hardware testing will be enabled.",
        "CoverSub",
    )
)
story.append(Spacer(1, 0.35 * inch))
status_table = Table(
    [
        [
            p("CURRENT STATUS", "CoverStatus"),
            p(
                "<b>Simulation is available.</b><br/>Physical network communication is not yet enabled.",
                "CoverStatus",
            ),
        ]
    ],
    colWidths=[1.45 * inch, 4.95 * inch],
)
status_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#103848")),
            ("BOX", (0, 0), (-1, -1), 0.8, CYAN),
            ("LINEBEFORE", (0, 0), (0, -1), 4, CYAN),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 11),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
        ]
    )
)
story.append(status_table)
story.append(Spacer(1, 1.15 * inch))
story.append(
    p(
        "Prepared for firmware engineering review<br/>Saber Industrial Applications",
        "CoverSub",
    )
)
story.append(PageBreak())

# Page 2
story.append(p("Purpose and current status", "H1x"))
story.append(
    p(
        "The LSN Engineering Console is prepared for integration with the physical ESP32/WT32-ETH01 "
        "firmware, but <b>physical device communication is not enabled in the current version</b>.",
    )
)
story.append(
    p(
        "Hardware Mode is intentionally locked because the ESP32’s final network and communication "
        "interface has not yet been supplied. The Console does not currently send discovery packets, "
        "open a device session, or issue commands to physical hardware.",
    )
)
story.append(Spacer(1, 0.06 * inch))
story.append(
    callout(
        "Why this is intentionally disabled",
        "We do not want to invent a protocol or require unnecessary firmware changes. The preferred "
        "approach is to understand the interface already implemented—or planned—by the firmware engineer, "
        "then adapt the Console to match it while preserving the required safety behavior.",
        PALE_AMBER,
        AMBER,
    )
)
story.append(Spacer(1, 0.15 * inch))
story.append(p("What the Console already provides", "H2x"))
ready_items = [
    "A working Simulation Mode for reviewing and validating expected LSN behavior.",
    "Device identity, status, control, diagnostics, runtime, fault, and guided test screens.",
    "A configurable Device Profile for firmware fields and protocol mappings.",
    "Safety gates for enable/disable behavior and connection-loss handling.",
    "Telemetry freshness rules that distinguish live, stale, and unknown evidence.",
    "Firmware integration package generation and implementation checklists.",
    "A packaged Windows architecture designed to keep future network sockets in the isolated Electron main process.",
]
for item in ready_items:
    story.append(bullet(item))
story.append(Spacer(1, 0.11 * inch))
story.append(
    callout(
        "Important validation boundary",
        "Simulation results help verify the logical contract, but they are not physical firmware validation. "
        "Only evidence captured through the completed hardware connection may be treated as physical test evidence.",
    )
)
story.append(Spacer(1, 0.14 * inch))
story.append(p("Requested approach", "H2x"))
story.append(
    p(
        "Please share the interface that currently exists—or the interface you intend to implement. "
        "Incomplete or provisional details are acceptable; unresolved items can remain marked <b>TBD</b>. "
        "After review, the Console will be adapted to that real interface wherever practical.",
    )
)
story.append(PageBreak())

# Page 3
story.append(p("Information requested", "H1x"))
story.append(
    p(
        "Please provide whatever is currently known in each area. Existing source headers, packet captures, "
        "test scripts, or short examples are welcome and may answer several sections at once.",
    )
)
story.append(
    numbered_section(
        1,
        "Physical network",
        [
            "Ethernet or Wi-Fi.",
            "DHCP or static addressing.",
            "Default IPv4 address or hostname, if applicable.",
        ],
    )
)
story.append(
    numbered_section(
        2,
        "Device discovery",
        [
            "How should the application locate the ESP32?",
            "Fixed IP, mDNS, UDP broadcast, EtherNet/IP ListIdentity, or another method?",
        ],
    )
)
story.append(
    numbered_section(
        3,
        "Communication protocol",
        [
            "EtherNet/IP/CIP, Modbus TCP, HTTP, WebSocket, custom TCP/UDP, or another protocol.",
            "TCP/UDP port numbers and whether a session must be established first.",
        ],
    )
)
story.append(
    numbered_section(
        4,
        "Device identity",
        [
            "Product name, hardware model, firmware version, and serial number.",
            "Vendor ID, device type, and product code, if applicable.",
        ],
    )
)
story.append(
    numbered_section(
        5,
        "Commands and telemetry",
        [
            "How values are read and how enable/disable commands are sent.",
            "Mappings for Ready, fault, output-active, timer, runtime, and enable count.",
            "Command IDs, object paths, registers, endpoints, or message formats.",
        ],
    )
)
story.append(PageBreak())

# Page 4
story.append(p("Information requested — continued", "H1x"))
story.append(
    numbered_section(
        6,
        "Data representation",
        [
            "Data types and field sizes.",
            "Byte order, string encoding, and bit/byte packing.",
            "Enum values and fault-code definitions.",
        ],
    )
)
story.append(
    numbered_section(
        7,
        "Safety behavior",
        [
            "Expected behavior when communication is lost.",
            "Firmware watchdog availability and timeout behavior.",
            "Conditions that must be satisfied before enable is accepted.",
            "How firmware confirms that the physical output is active.",
        ],
    )
)
story.append(
    numbered_section(
        8,
        "Useful examples",
        [
            "Existing test script, application, or command-line tool.",
            "Firmware header containing protocol definitions.",
            "Example request/response packets or a successful packet capture.",
            "Any existing interface or bring-up documentation.",
        ],
    )
)
story.append(Spacer(1, 0.14 * inch))
story.append(p("What happens after we receive this information", "H1x"))
next_steps = [
    ("1", "Review", "Confirm the actual discovery, transport, data mapping, and safety contract."),
    ("2", "Integrate", "Add device discovery or manual IP connection, identity verification, and session handling."),
    ("3", "Exercise", "Enable live reads, safe commands, fault handling, and physical guided tests."),
    ("4", "Validate", "Run the acceptance checklist on a real WT32-ETH01 and keep evidence separate from simulation."),
]
cards = []
for num, title, body in next_steps:
    cards.append(
        [
            p(num, "SectionNum"),
            [
                p(title, "CalloutTitle"),
                p(body, "Smallx"),
            ],
        ]
    )
next_table = Table(cards, colWidths=[0.42 * inch, 6.55 * inch])
next_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (0, -1), CYAN_DARK),
            ("BACKGROUND", (1, 0), (1, -1), PALE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ("GRID", (0, 0), (-1, -1), 0.5, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]
    )
)
story.append(next_table)
story.append(Spacer(1, 0.16 * inch))
story.append(
    callout(
        "Shared objective",
        "Make the Console conform to the firmware implementation wherever practical—not force a new protocol "
        "onto the ESP32 without reviewing what already exists. Once integrated, the Windows Console will provide "
        "the physical connection and test workflow needed to verify the firmware against the LSN contract.",
    )
)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc = HandoffDocument(str(OUTPUT))
doc.build(story)
print(OUTPUT)