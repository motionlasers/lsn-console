import { CONSOLE_VERSION } from "./release.ts";

export type TourPlacement = "top" | "right" | "bottom" | "left";
export type TourPhase = "intro" | "overview" | "detail";

export interface TourStep {
  id: string;
  route: string;
  page: string;
  target: string;
  title: string;
  description: string;
  phase?: TourPhase; // defaults to "detail" when absent
  preferredPlacement?: TourPlacement;
  unavailableDescription?: string;
  steps?: string[]; // optional numbered sub-steps rendered as an inline list
}

/** All navigation destinations that must each appear in at least one overview step. */
export const OVERVIEW_NAV_PAGES = [
  "Dashboard",
  "Device & Capabilities",
  "Control",
  "Status",
  "Runtime",
  "Diagnostics",
  "Protocol",
  "Tests",
  "Stress",
  "Firmware",
  "Profile",
  "Modules",
  "Logs",
  "Help",
  "Downloads",
  "Settings",
] as const;

export const TOUR_STEPS: TourStep[] = [
  // ─── INTRO ──────────────────────────────────────────────────────────────
  {
    id: "master-workflow",
    route: "/",
    page: "Dashboard",
    target: "sidebar-nav",
    title: "From concept to verified firmware — 5 steps",
    description: "Follow these five steps to take a firmware design from first concept to a production-ready build.",
    phase: "intro",
    preferredPlacement: "right",
    steps: [
      "Configure — Set your session identity, select your hardware capabilities, and establish the simulation environment on the Dashboard and Device & Capabilities pages.",
      "Validate logic — Step through Control, Status, Runtime, and Diagnostics to confirm your firmware behaves correctly against every rule and edge case — no hardware required.",
      "Run the test suite — Use the Tests and Stress pages to execute the full validation suite and verify deterministic timing under load.",
      "Package for handoff — On the Profile and Firmware pages, review the active capability snapshot, stage metadata, and export the firmware integration bundle.",
      "Download & test on hardware — Visit the Downloads page, install the Windows engineering console, connect your target device, and run a live session to certify the build for production.",
    ],
  },
  {
    id: "sidebar-nav",
    route: "/",
    page: "Dashboard",
    target: "sidebar-nav",
    title: "Understand the console layout",
    description: "The navigation panel organises the console into sections covering session setup, active control and status, runtime diagnostics and protocol inspection, firmware management, and configuration. The tour visits each section in sequence.",
    phase: "intro",
    preferredPlacement: "right",
  },

  // ─── OVERVIEW ────────────────────────────────────────────────────────────
  {
    id: "overview-nav-session",
    route: "/",
    page: "Overview",
    target: "overview-nav-session",
    title: "Session setup pages",
    description: "Dashboard establishes your simulation session, confirms device identity, and displays active logical evidence. Device & Capabilities selects the validation environment, verifies identity requirements, and documents hardware acknowledgement.",
    phase: "overview",
    preferredPlacement: "right",
  },
  {
    id: "overview-nav-monitoring",
    route: "/",
    page: "Overview",
    target: "overview-nav-monitoring",
    title: "Active control and status pages",
    description: "Control issues and verifies enable requests and reviews safety gates. Status centralizes the complete logical snapshot with capability-filtered fields. Runtime tracks deterministic counters and validates timer accuracy and persistence.",
    phase: "overview",
    preferredPlacement: "right",
  },
  {
    id: "overview-nav-analysis",
    route: "/",
    page: "Overview",
    target: "overview-nav-analysis",
    title: "Analysis and testing pages",
    description: "Diagnostics injects controlled failures and correlates health evidence. Protocol inspects request and response transactions. Tests runs the validation suite and interprets each result. Stress configures and monitors deterministic cycle runs.",
    phase: "overview",
    preferredPlacement: "right",
  },
  {
    id: "overview-nav-management",
    route: "/",
    page: "Overview",
    target: "overview-nav-management",
    title: "Firmware and profile pages",
    description: "Firmware stages metadata and rehearses update and recovery scenarios. Profile confirms enabled capabilities, audits the active interface, and exports the firmware handoff. Modules reviews hardware and logical building blocks.",
    phase: "overview",
    preferredPlacement: "right",
  },
  {
    id: "overview-nav-support",
    route: "/",
    page: "Overview",
    target: "overview-nav-support",
    title: "Information and configuration pages",
    description: "Logs preserves the chronological audit trail for debugging and handoff. Help documents operating workflows and validation boundaries. Downloads offers the local engineering console and firmware integration package. Settings configures branding, persistence, and simulation preferences.",
    phase: "overview",
    preferredPlacement: "right",
  },

  // ─── DETAIL ──────────────────────────────────────────────────────────────
  {
    id: "dashboard-identity",
    route: "/",
    page: "Dashboard",
    target: "dashboard-identity",
    title: "Confirm the active platform",
    description: "Start by confirming product identity, target hardware, firmware version, and the active device profile. Discovery populates this evidence without changing firmware status.",
    preferredPlacement: "bottom",
  },
  {
    id: "dashboard-session",
    route: "/",
    page: "Dashboard",
    target: "dashboard-session",
    title: "Establish a simulation session",
    description: "Discover, connect, and disconnect the local simulator here. Hardware Mode remains transport-locked while protocol mappings and endpoints are unresolved.",
    preferredPlacement: "left",
  },
  {
    id: "dashboard-state",
    route: "/",
    page: "Dashboard",
    target: "dashboard-state",
    title: "Read current logical evidence",
    description: "These indicators separate the requested state, permitted state, actual output, safety inputs, and faults. When telemetry is not live, values are explicitly last-reported evidence.",
    preferredPlacement: "right",
  },
  {
    id: "dashboard-controls",
    route: "/",
    page: "Dashboard",
    target: "dashboard-controls",
    title: "Exercise the primary workflow",
    description: "Use the enable request and optional safety injections only after connecting in Simulation Mode. The tour never operates these controls or changes device state.",
    preferredPlacement: "top",
  },
  {
    id: "device-mode",
    route: "/device",
    page: "Device & Capabilities",
    target: "device-mode",
    title: "Choose the validation environment",
    description: "Simulation Mode enables local logical testing. Hardware Mode is intentionally non-transmitting and requires an explicit bench acknowledgement without unlocking transport.",
    preferredPlacement: "right",
  },
  {
    id: "device-identity",
    route: "/device",
    page: "Device & Capabilities",
    target: "device-identity",
    title: "Verify identity requirements",
    description: "Compare the expected profile, protocol version, target platform, and hardware revision before treating any response as relevant evidence.",
    preferredPlacement: "left",
  },
  {
    id: "device-hardware-lock",
    route: "/device",
    page: "Device & Capabilities",
    target: "device-hardware-lock",
    title: "Understand the hardware lock",
    description: "When Hardware Mode is selected, this area records acknowledgement only. Missing or mode-dependent content is explained here without changing modes.",
    unavailableDescription: "The hardware acknowledgement panel is hidden in the current mode. Hardware transport remains locked until firmware and mappings are implemented.",
    preferredPlacement: "left",
  },
  {
    id: "control-emission",
    route: "/control",
    page: "Control",
    target: "control-emission",
    title: "Issue and verify enable requests",
    description: "The request, permission, and active output are separate signals. A request is available only for a connected simulation session and does not imply physical output validation.",
    preferredPlacement: "right",
  },
  {
    id: "control-safety",
    route: "/control",
    page: "Control",
    target: "control-safety",
    title: "Review safety gates",
    description: "Capability-driven safety inputs appear only when enabled. Core fault state remains visible even when optional interlock or remote-stop capabilities are absent.",
    preferredPlacement: "right",
  },
  {
    id: "control-recent",
    route: "/control",
    page: "Control",
    target: "control-recent",
    title: "Inspect the latest action",
    description: "Compare expected and actual behavior, simulator-envelope bytes, and latency. Empty state is normal until an action is issued.",
    preferredPlacement: "left",
  },
  {
    id: "status-overview",
    route: "/status",
    page: "Status",
    target: "status-overview",
    title: "Read the complete logical snapshot",
    description: "Status centralizes every active profile field while preserving unknown-versus-last-reported telemetry semantics.",
    preferredPlacement: "bottom",
  },
  {
    id: "status-fields",
    route: "/status",
    page: "Status",
    target: "status-fields",
    title: "Interpret capability-filtered fields",
    description: "Only fields supported by enabled capabilities are listed. Boolean, counter, enum, and fault values remain logical simulator evidence until mapped firmware exists.",
    preferredPlacement: "top",
  },
  {
    id: "runtime-counters",
    route: "/runtime",
    page: "Runtime",
    target: "runtime-counters",
    title: "Track deterministic counters",
    description: "Timer state, active-output runtime, enable count, and persistence health advance from simulator state. Runtime accumulates only while output is actually active.",
    preferredPlacement: "bottom",
  },
  {
    id: "runtime-observation",
    route: "/runtime",
    page: "Runtime",
    target: "runtime-observation",
    title: "Compare session readings",
    description: "Capture readings and run an observation to compare LSN runtime growth against PC elapsed time without conflating disconnected values with live telemetry.",
    preferredPlacement: "top",
  },
  {
    id: "runtime-timer-test",
    route: "/runtime",
    page: "Runtime",
    target: "runtime-timer-test",
    title: "Validate timer accuracy",
    description: "Configure duration and tolerance, then run the guided timer test. Results report measured active-output time and exact timing difference.",
    preferredPlacement: "top",
  },
  {
    id: "runtime-persistence-test",
    route: "/runtime",
    page: "Runtime",
    target: "runtime-persistence-test",
    title: "Validate persistence safely",
    description: "The guided workflow compares runtime and firmware before and after restart. Manual Hardware Mode evidence can never be promoted to a simulation persistence pass.",
    preferredPlacement: "top",
  },
  {
    id: "diagnostics-faults",
    route: "/diagnostics",
    page: "Diagnostics",
    target: "diagnostics-faults",
    title: "Inject controlled failures",
    description: "Exercise communication, storage, and supported safety faults in Simulation Mode. Each injection is explicit and reversible.",
    preferredPlacement: "right",
  },
  {
    id: "diagnostics-health",
    route: "/diagnostics",
    page: "Diagnostics",
    target: "diagnostics-health",
    title: "Correlate health evidence",
    description: "Use the resulting state and diagnostic evidence to understand why operations are blocked before clearing the injected condition.",
    preferredPlacement: "left",
  },
  {
    id: "protocol-transactions",
    route: "/protocol",
    page: "Protocol",
    target: "protocol-transactions",
    title: "Inspect protocol transactions",
    description: "Review request and response direction, operation, status, latency, and validation outcome. Simulator envelope bytes are not presented as finalized CIP mappings.",
    preferredPlacement: "bottom",
  },
  {
    id: "protocol-table",
    route: "/protocol",
    page: "Protocol",
    target: "protocol-table",
    title: "Open transaction evidence",
    description: "Select a row when available to inspect decoded request and response detail. Empty history is safe and does not interrupt the tour.",
    preferredPlacement: "top",
  },
  {
    id: "tests-suite",
    route: "/tests",
    page: "Tests",
    target: "tests-suite",
    title: "Run the validation suite",
    description: "The suite combines automated simulation checks with clearly labeled manual or hardware-required cases. Capability-disabled tests are excluded rather than falsely passed.",
    preferredPlacement: "bottom",
  },
  {
    id: "tests-actions",
    route: "/tests",
    page: "Tests",
    target: "tests-actions",
    title: "Choose the test scope",
    description: "Run eligible tests or reset evidence from these controls. The tour highlights them without triggering any run or changing validation results.",
    preferredPlacement: "left",
  },
  {
    id: "tests-table",
    route: "/tests",
    page: "Tests",
    target: "tests-table",
    title: "Interpret each result",
    description: "Inspect requirement, status, evidence, and scope. Simulation PASS never advances firmware implementation status or substitutes for physical validation.",
    preferredPlacement: "top",
  },
  {
    id: "stress-config",
    route: "/stress",
    page: "Stress",
    target: "stress-config",
    title: "Configure deterministic stress",
    description: "Set cycle count, active and inactive durations, fault probability, sampling intervals, and a hard time limit before starting.",
    preferredPlacement: "right",
  },
  {
    id: "stress-progress",
    route: "/stress",
    page: "Stress",
    target: "stress-progress",
    title: "Monitor active stress evidence",
    description: "Progress distinguishes completed cycles, active-output duration, failures, and cleanliness. PASS requires a clean completed run.",
    preferredPlacement: "left",
  },
  {
    id: "firmware-package",
    route: "/firmware",
    page: "Firmware",
    target: "firmware-package",
    title: "Stage firmware metadata",
    description: "Review the current and candidate firmware metadata before rehearsing an update. This simulator does not flash physical hardware.",
    preferredPlacement: "bottom",
  },
  {
    id: "firmware-controls",
    route: "/firmware",
    page: "Firmware",
    target: "firmware-controls",
    title: "Rehearse update and recovery",
    description: "Use these controls to simulate transfer, interruption, restart, and recovery behavior while keeping firmware implementation claims separate.",
    preferredPlacement: "right",
  },
  {
    id: "firmware-history",
    route: "/firmware",
    page: "Firmware",
    target: "firmware-history",
    title: "Verify update outcomes",
    description: "Read phase, progress, errors, and resulting version evidence. Interrupted or simulated updates cannot establish physical firmware validity.",
    preferredPlacement: "left",
  },
  {
    id: "profile-capabilities",
    route: "/profile",
    page: "Profile",
    target: "profile-capabilities",
    title: "Confirm enabled capabilities",
    description: "Capabilities determine which interface fields, tests, controls, and modules participate in normal workflows. Future hardware remains disabled unless explicitly simulated.",
    preferredPlacement: "bottom",
  },
  {
    id: "profile-interface",
    route: "/profile",
    page: "Profile",
    target: "profile-interface",
    title: "Audit the active interface",
    description: "Review symbolic fields, data types, access, mapping state, firmware status, and simulation evidence. Unresolved enum, layout, identity, byte, bit, and GPIO values remain TBD.",
    preferredPlacement: "top",
  },
  {
    id: "profile-export",
    route: "/profile",
    page: "Profile",
    target: "profile-export",
    title: "Export the firmware handoff",
    description: "Generate the versioned firmware integration ZIP. It includes active C interfaces plus the complete profile JSON without inventing unresolved mappings.",
    preferredPlacement: "left",
  },
  {
    id: "modules-overview",
    route: "/modules",
    page: "Modules",
    target: "modules-overview",
    title: "Review module availability",
    description: "Modules summarize the hardware and logical building blocks declared by the active profile.",
    preferredPlacement: "bottom",
  },
  {
    id: "modules-list",
    route: "/modules",
    page: "Modules",
    target: "modules-list",
    title: "Distinguish enabled from future modules",
    description: "Disabled capability modules remain visible as profile definitions but are excluded from normal runtime behavior until explicitly enabled.",
    preferredPlacement: "top",
  },
  {
    id: "logs-overview",
    route: "/logs",
    page: "Logs",
    target: "logs-overview",
    title: "Use the audit trail",
    description: "Logs preserve chronological console actions and protocol evidence for debugging and handoff.",
    preferredPlacement: "bottom",
  },
  {
    id: "logs-actions",
    route: "/logs",
    page: "Logs",
    target: "logs-actions",
    title: "Filter and export evidence",
    description: "Narrow the log view or export records for analysis. Exporting does not modify the stored transaction history.",
    preferredPlacement: "left",
  },
  {
    id: "logs-table",
    route: "/logs",
    page: "Logs",
    target: "logs-table",
    title: "Trace individual events",
    description: "Use timestamp, severity, operation, and payload context to correlate control, test, fault, and lifecycle activity.",
    preferredPlacement: "top",
  },
  {
    id: "help-safety",
    route: "/help",
    page: "Help",
    target: "help-safety",
    title: "Keep validation boundaries visible",
    description: "The guide begins with the non-negotiable distinction between simulation evidence, firmware implementation, and physical safety validation.",
    preferredPlacement: "bottom",
  },
  {
    id: "help-workflows",
    route: "/help",
    page: "Help",
    target: "help-workflows",
    title: "Follow the operating guide",
    description: "Use these workflows when connecting, exercising controls, validating runtime, injecting faults, and collecting evidence.",
    preferredPlacement: "top",
  },
  {
    id: "help-reference",
    route: "/help",
    page: "Help",
    target: "help-reference",
    title: "Return to reference material",
    description: "Reference sections document expected behavior and boundaries. Replay this tour from Settings whenever the interface changes.",
    preferredPlacement: "top",
  },
  {
    id: "settings-overview",
    route: "/settings",
    page: "Settings",
    target: "settings-overview",
    title: "Configure the local console",
    description: "Settings control branding, developer visibility, persistence, timing, fault simulation, and local import/export behavior.",
    preferredPlacement: "bottom",
  },
  {
    id: "settings-preferences",
    route: "/settings",
    page: "Settings",
    target: "settings-preferences",
    title: "Adjust persistent preferences",
    description: "Preferences are stored locally when persistence is enabled. Fault and timing controls affect only the simulation environment.",
    preferredPlacement: "top",
  },
  {
    id: "settings-tour",
    route: "/settings",
    page: "Settings",
    target: "settings-tour",
    title: "Replay the full walkthrough",
    description: "Replay Tour always restarts this detailed walkthrough from the first Dashboard section, regardless of the first-launch preference.",
    preferredPlacement: "left",
  },
  {
    id: "downloads-release",
    route: "/downloads",
    page: "Downloads",
    target: "downloads-release",
    title: "Move from the web simulator to local tools",
    description: "Downloads is the handoff point from web simulation to local engineering. It provides the Windows Desktop Console, the Firmware Integration Package, and a clear picture of what is functional now versus what awaits real firmware and CIP integration.",
    preferredPlacement: "right",
  },
  {
    id: "downloads-windows",
    route: "/downloads",
    page: "Downloads",
    target: "downloads-windows",
    title: "Install the Windows Desktop Console",
    description: `The v${CONSOLE_VERSION} Windows Console is a packaged Electron application running the same shared React UI — no Node.js, Python, or build tools required. Download the installer for a standard Windows setup or the portable ZIP. Windows SmartScreen will warn on first run because this is an unsigned internal engineering build; choose 'More info' then 'Run anyway' to proceed.`,
    preferredPlacement: "right",
  },
  {
    id: "downloads-changelog",
    route: "/downloads",
    page: "Downloads",
    target: "downloads-changelog",
    title: "Review what changed and known limitations",
    description: "Current Release Notes lists every addition, change, and fix in this Console version, its impact on the LSN Protocol and Device Profile, and any known limitations. Full Changelog opens the complete version history. Console, Protocol, Device Profile, and Firmware Interface are versioned independently so the impact of each release is unambiguous.",
    preferredPlacement: "right",
  },
  {
    id: "downloads-package",
    route: "/downloads",
    page: "Downloads",
    target: "downloads-package",
    title: "Generate the current firmware handoff",
    description: "Create the Firmware Integration Package and individual interface resources directly from the active Device Profile without duplicating protocol definitions.",
    preferredPlacement: "left",
  },
  {
    id: "downloads-workflow",
    route: "/downloads",
    page: "Downloads",
    target: "downloads-workflow",
    title: "Begin firmware development",
    description: `You're ready to begin firmware development. Use both v${CONSOLE_VERSION} handoff resources here: the Windows Development Preview Console and the unchanged LSN-Firmware-Interface-v0.1 package.`,
    preferredPlacement: "left",
  },
];

/** Return the detailed walkthrough steps available on a specific route. */
export function getDetailStepsForRoute(route: string): TourStep[] {
  return TOUR_STEPS.filter(
    (step) => (step.phase ?? "detail") === "detail" && step.route === route,
  );
}

/** Whether a route has at least one step suitable for a page-scoped guide. */
export function hasPageTour(route: string): boolean {
  return getDetailStepsForRoute(route).length > 0;
}

/**
 * Number of distinct navigation pages in the detailed walkthrough.
 * Overview and intro steps are excluded from this count.
 */
export const TOUR_PAGE_COUNT = new Set(
  TOUR_STEPS.filter(s => (s.phase ?? "detail") === "detail").map(step => step.page)
).size;

/** Number of overview steps in the tour opening sequence. */
export const TOUR_OVERVIEW_COUNT = TOUR_STEPS.filter(s => s.phase === "overview").length;

export function getTourPageProgress(stepIndex: number) {
  const safeIndex = Math.min(Math.max(stepIndex, 0), TOUR_STEPS.length - 1);
  const step = TOUR_STEPS[safeIndex];
  const phase: TourPhase = step?.phase ?? "detail";

  if (phase === "intro") {
    return {
      phase,
      page: step?.page ?? "",
      pageIndex: 0,
      pageCount: TOUR_PAGE_COUNT,
      stepOnPage: 1,
      stepsOnPage: 1,
      overviewIndex: 0,
      overviewCount: TOUR_OVERVIEW_COUNT,
    };
  }

  if (phase === "overview") {
    const overviewSteps = TOUR_STEPS.filter(s => s.phase === "overview");
    const overviewIndex = overviewSteps.findIndex(s => s.id === step?.id) + 1;
    return {
      phase,
      page: "Overview",
      pageIndex: 0,
      pageCount: TOUR_PAGE_COUNT,
      stepOnPage: overviewIndex,
      stepsOnPage: TOUR_OVERVIEW_COUNT,
      overviewIndex,
      overviewCount: TOUR_OVERVIEW_COUNT,
    };
  }

  // detail
  const page = step?.page ?? "";
  const pages = Array.from(
    new Set(TOUR_STEPS.filter(s => (s.phase ?? "detail") === "detail").map(s => s.page))
  );
  const stepsOnPage = TOUR_STEPS.filter(s => (s.phase ?? "detail") === "detail" && s.page === page);
  const stepOnPage = stepsOnPage.findIndex(s => s.id === step?.id) + 1;
  return {
    phase,
    page,
    pageIndex: pages.indexOf(page) + 1,
    pageCount: TOUR_PAGE_COUNT,
    stepOnPage,
    stepsOnPage: stepsOnPage.length,
    overviewIndex: 0,
    overviewCount: TOUR_OVERVIEW_COUNT,
  };
}
