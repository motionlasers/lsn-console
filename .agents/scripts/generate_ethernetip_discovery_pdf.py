from pathlib import Path

from reportlab.lib import colors
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
OUTPUT = ROOT / "exports" / "LSN_EtherNetIP_Discovery_and_Connection_Steps.pdf"
LSN_LOGO = ROOT / "attached_assets" / "LSN-Industrial-transparent_1786661922957.png"
SABER_LOGO = ROOT / "attached_assets" / "Saber-Industrial-Applications-Logo_1786661980178.png"

NAVY = colors.HexColor("#071923")
NAVY_2 = colors.HexColor("#0B3342")
CYAN = colors.HexColor("#22D3EE")
TEAL = colors.HexColor("#087E91")
INK = colors.HexColor("#12212A")
MUTED = colors.HexColor("#52636D")
LINE = colors.HexColor("#CBD8DC")
PALE = colors.HexColor("#F2F7F8")
PALE_CYAN = colors.HexColor("#E7F9FC")
PALE_AMBER = colors.HexColor("#FFF6E5")
AMBER = colors.HexColor("#D97706")
WHITE = colors.white


class GuideDocument(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(
            filename,
            pagesize=letter,
            rightMargin=0.62 * inch,
            leftMargin=0.62 * inch,
            topMargin=0.68 * inch,
            bottomMargin=0.58 * inch,
            title="LSN EtherNet/IP Discovery and Connection Steps",
            author="Saber Industrial Applications",
            subject="ESP32 / WT32-ETH01 discovery and EtherNet/IP transport-session handoff",
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
        self.addPageTemplates([PageTemplate(id="guide", frames=[frame], onPage=self.draw_page)])

    def draw_page(self, canvas, doc):
        width, height = letter
        canvas.saveState()
        if doc.page == 1:
            canvas.setFillColor(NAVY)
            canvas.rect(0, 0, width, height, stroke=0, fill=1)
            canvas.setFillColor(CYAN)
            canvas.rect(0, 0, 0.12 * inch, height, stroke=0, fill=1)
            canvas.setFillColor(NAVY_2)
            canvas.circle(width - 0.35 * inch, height - 0.4 * inch, 2.0 * inch, stroke=0, fill=1)
            canvas.circle(width - 0.5 * inch, 0.1 * inch, 1.5 * inch, stroke=0, fill=1)
        else:
            canvas.setStrokeColor(LINE)
            canvas.setLineWidth(0.5)
            canvas.line(0.62 * inch, height - 0.43 * inch, width - 0.62 * inch, height - 0.43 * inch)
            canvas.setFont("Helvetica-Bold", 7.5)
            canvas.setFillColor(TEAL)
            canvas.drawString(0.62 * inch, height - 0.31 * inch, "LSN ENGINEERING CONSOLE")
            canvas.setFont("Helvetica", 7.5)
            canvas.setFillColor(MUTED)
            canvas.drawRightString(width - 0.62 * inch, height - 0.31 * inch, "ETHERNET/IP HANDSHAKE GUIDE")
            canvas.line(0.62 * inch, 0.4 * inch, width - 0.62 * inch, 0.4 * inch)
            canvas.setFont("Helvetica", 7)
            canvas.drawString(0.62 * inch, 0.25 * inch, "Saber Industrial Applications  •  Firmware engineering handoff")
            canvas.drawRightString(width - 0.62 * inch, 0.25 * inch, f"Page {doc.page}")
        canvas.restoreState()


base = getSampleStyleSheet()
styles = {
    "cover_kicker": ParagraphStyle(
        "cover_kicker",
        parent=base["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13,
        textColor=CYAN,
        spaceAfter=10,
    ),
    "cover_title": ParagraphStyle(
        "cover_title",
        parent=base["Title"],
        fontName="Helvetica-Bold",
        fontSize=29,
        leading=34,
        textColor=WHITE,
        spaceAfter=12,
    ),
    "cover_sub": ParagraphStyle(
        "cover_sub",
        parent=base["Normal"],
        fontName="Helvetica",
        fontSize=12,
        leading=18,
        textColor=colors.HexColor("#C9E7ED"),
    ),
    "cover_box_title": ParagraphStyle(
        "cover_box_title",
        parent=base["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13,
        textColor=WHITE,
    ),
    "cover_box_body": ParagraphStyle(
        "cover_box_body",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=8.8,
        leading=12.5,
        textColor=WHITE,
    ),
    "h1": ParagraphStyle(
        "h1",
        parent=base["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=NAVY,
        spaceAfter=9,
    ),
    "h2": ParagraphStyle(
        "h2",
        parent=base["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=11.5,
        leading=14,
        textColor=TEAL,
        spaceBefore=7,
        spaceAfter=4,
    ),
    "body": ParagraphStyle(
        "body",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=9,
        leading=12.7,
        textColor=INK,
        spaceAfter=4,
    ),
    "small": ParagraphStyle(
        "small",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=8.1,
        leading=11,
        textColor=MUTED,
    ),
    "bullet": ParagraphStyle(
        "bullet",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=8.7,
        leading=12,
        leftIndent=13,
        firstLineIndent=-7,
        textColor=INK,
        spaceAfter=2.5,
    ),
    "step_num": ParagraphStyle(
        "step_num",
        parent=base["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=16,
        alignment=1,
        textColor=WHITE,
    ),
    "step_title": ParagraphStyle(
        "step_title",
        parent=base["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=12.5,
        textColor=NAVY,
        spaceAfter=2,
    ),
    "code": ParagraphStyle(
        "code",
        parent=base["BodyText"],
        fontName="Courier",
        fontSize=8.1,
        leading=11,
        textColor=NAVY,
    ),
}


def para(text, style="body"):
    return Paragraph(text, styles[style])


def bullet(text):
    return Paragraph(f"•&nbsp;&nbsp;{text}", styles["bullet"])


def callout(title, body, background=PALE_CYAN, accent=TEAL):
    table = Table(
        [[[para(title, "step_title"), para(body, "body")]]],
        colWidths=[7.08 * inch],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), background),
                ("BOX", (0, 0), (-1, -1), 0.7, accent),
                ("LINEBEFORE", (0, 0), (0, -1), 4, accent),
                ("LEFTPADDING", (0, 0), (-1, -1), 14),
                ("RIGHTPADDING", (0, 0), (-1, -1), 14),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def step(number, title, actor, action, result):
    badge = Table([[para(str(number), "step_num")]], colWidths=[0.35 * inch], rowHeights=[0.35 * inch])
    badge.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), TEAL),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    detail = [
        para(title, "step_title"),
        para(f"<b>{actor}:</b> {action}", "body"),
        para(f"<b>Expected result:</b> {result}", "small"),
    ]
    table = Table([[badge, detail]], colWidths=[0.48 * inch, 6.6 * inch])
    table.setStyle(
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
    return KeepTogether(table)


story = []

# Cover
story.append(Spacer(1, 0.28 * inch))
logos = Table(
    [[
        Image(str(LSN_LOGO), width=0.82 * inch, height=0.82 * inch),
        Image(str(SABER_LOGO), width=1.65 * inch, height=0.46 * inch),
    ]],
    colWidths=[4.95 * inch, 2.1 * inch],
)
logos.setStyle(
    TableStyle(
        [
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]
    )
)
story.append(logos)
story.append(Spacer(1, 0.95 * inch))
story.append(para("FIRMWARE ENGINEERING HANDOFF", "cover_kicker"))
story.append(para("EtherNet/IP Discovery<br/>and Connection Steps", "cover_title"))
story.append(para("ESP32 / WT32-ETH01  •  UDP and TCP port 44818", "cover_sub"))
story.append(Spacer(1, 0.4 * inch))
cover_box = Table(
    [[
        para("IMMEDIATE<br/>GOAL", "cover_box_title"),
        para(
            "Make the ESP32 respond to a standard <b>ListIdentity</b> request, then establish a standard "
            "EtherNet/IP encapsulation session. Control and telemetry mappings are not required for this stage.",
            "cover_box_body",
        ),
    ]],
    colWidths=[1.45 * inch, 4.95 * inch],
)
cover_box.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#123B49")),
            ("BOX", (0, 0), (-1, -1), 0.8, CYAN),
            ("LINEBEFORE", (0, 0), (0, -1), 4, CYAN),
            ("TEXTCOLOR", (0, 0), (-1, -1), WHITE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 11),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
        ]
    )
)
story.append(cover_box)
story.append(Spacer(1, 1.15 * inch))
story.append(
    para(
        "Scope: discovery and transport-session handshake only<br/>Prepared for firmware engineering review",
        "cover_sub",
    )
)
story.append(PageBreak())

# Discovery page
story.append(para("Stage 1 — Discover the ESP32", "h1"))
story.append(
    para(
        "The Console and ESP32 must be on the same IPv4 subnet for normal broadcast discovery. "
        "The Windows firewall and network profile must allow UDP traffic on port <b>44818</b>.",
    )
)
story.append(
    callout(
        "Protocol used",
        "Standard EtherNet/IP Encapsulation Protocol <b>ListIdentity</b>: command "
        "<font name='Courier'>0x0063</font>, sent by UDP to the subnet broadcast address on port "
        "<font name='Courier'>44818</font>.",
    )
)
story.append(Spacer(1, 0.12 * inch))
story.append(
    step(
        1,
        "Open a bounded UDP discovery socket",
        "Console",
        "Select the active Ethernet adapter, enable broadcast, and prepare a short response window.",
        "The socket can transmit and receive UDP datagrams without exposing raw network access to the renderer.",
    )
)
story.append(
    step(
        2,
        "Broadcast ListIdentity",
        "Console",
        "Send a 24-byte EtherNet/IP encapsulation header with command 0x0063, zero session handle, and no payload to the subnet broadcast address on UDP port 44818.",
        "All EtherNet/IP targets on the local subnet receive the discovery request.",
    )
)
story.append(
    step(
        3,
        "Return the standard identity item",
        "ESP32 firmware",
        "Receive the ListIdentity request and reply to the sender with a valid ListIdentity response containing an Identity Item (type 0x000C).",
        "The response contains the device socket address and identity fields.",
    )
)
story.append(
    step(
        4,
        "Validate and display the response",
        "Console",
        "Check packet length, command, status, identity-item type, source address, and field bounds before accepting the device.",
        "A discovered-device row displays IP address, product name, revision, serial number, and compatibility status.",
    )
)
story.append(
    step(
        5,
        "Complete the response window",
        "Console",
        "Collect unique responses for a bounded period, ignore malformed or duplicate packets, and allow a controlled retry.",
        "The operator can select a discovered device or enter its IPv4 address manually if broadcast discovery is blocked.",
    )
)
story.append(Spacer(1, 0.08 * inch))
story.append(para("Identity values returned by the ESP32", "h2"))
identity = [
    "Encapsulation protocol version and socket address",
    "Vendor ID, device type, and product code",
    "Major/minor revision and device status",
    "Serial number, product name, and device state",
]
for item in identity:
    story.append(bullet(item))
story.append(
    callout(
        "Firmware confirmation needed",
        "Confirm that the ESP32 listens for ListIdentity on UDP 44818 and provide either the identity values "
        "it returns or one sample response/packet capture.",
        PALE_AMBER,
        AMBER,
    )
)
story.append(PageBreak())

# Connection page
story.append(para("Stage 2 — Establish the connection", "h1"))
story.append(
    para(
        "After the operator selects a discovered device, the Console establishes an EtherNet/IP "
        "<b>encapsulation session</b>. This confirms transport-level communication; it does not yet require "
        "the application-specific CIP field mappings used for control and telemetry.",
    )
)
story.append(
    callout(
        "Connection used",
        "Standard EtherNet/IP TCP connection to port <font name='Courier'>44818</font>, followed by "
        "<b>RegisterSession</b> command <font name='Courier'>0x0065</font> using encapsulation protocol version 1.",
    )
)
story.append(Spacer(1, 0.12 * inch))
story.append(
    step(
        1,
        "Select or enter the target address",
        "Operator",
        "Choose the ESP32 returned by discovery or enter its IPv4 address manually.",
        "The Console has one explicit target and does not automatically connect to an unknown responder.",
    )
)
story.append(
    step(
        2,
        "Open the TCP transport",
        "Console",
        "Connect to the selected ESP32 on TCP port 44818 using bounded connect and inactivity timeouts.",
        "A TCP connection is established or a clear timeout/refusal error is shown.",
    )
)
story.append(
    step(
        3,
        "Register the EtherNet/IP session",
        "Console",
        "Send RegisterSession (0x0065) with protocol version 1 and options 0.",
        "The ESP32 returns success and a non-zero session handle.",
    )
)
story.append(
    step(
        4,
        "Validate the session response",
        "Console",
        "Verify command, status, sender context, protocol version, payload size, and the returned session handle.",
        "The UI changes to CONNECTED only after a valid response.",
    )
)
story.append(
    step(
        5,
        "Use the registered session",
        "Console and ESP32",
        "Keep the TCP socket and session handle active for subsequent explicit CIP requests.",
        "The transport is ready; profile-specific reads and commands can be added after their CIP paths and encodings are confirmed.",
    )
)
story.append(
    step(
        6,
        "Disconnect cleanly",
        "Console",
        "Send UnRegisterSession (0x0066) when possible, close the TCP socket, clear the session handle, and mark telemetry non-live.",
        "The app returns to DISCONNECTED without retaining a stale physical session.",
    )
)
story.append(Spacer(1, 0.08 * inch))
story.append(para("Acceptance checklist for this stage", "h2"))
checks = [
    "The ESP32 appears after one ListIdentity broadcast on the same subnet.",
    "The displayed IP and identity match the physical unit.",
    "Manual IPv4 connection works when broadcast discovery is unavailable.",
    "RegisterSession returns a valid non-zero handle and the Console shows CONNECTED.",
    "Disconnect and reconnect complete without restarting either device.",
    "Malformed packets, timeout, cable removal, or socket closure return the Console to DISCONNECTED.",
]
for item in checks:
    story.append(bullet(item))
story.append(Spacer(1, 0.04 * inch))
story.append(
    para(
        "<b>Not required yet:</b> Enable/disable object paths, telemetry mappings, byte packing, enum values, "
        "fault codes, and watchdog details belong to the next physical test stage—not discovery or RegisterSession.",
        "small",
    )
)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
GuideDocument(str(OUTPUT)).build(story)
print(OUTPUT)