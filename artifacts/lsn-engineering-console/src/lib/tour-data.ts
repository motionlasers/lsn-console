export interface TourStep {
  id: string;
  route: string;
  title: string;
  description: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "dashboard",
    route: "/",
    title: "Dashboard & Simulation Safety",
    description: "Welcome to the LSN Engineering Console. This is your primary cockpit for validating firmware logic. Note: Simulation evidence provided here is for logical validation only and does NOT constitute physical validation or safety certification."
  },
  {
    id: "device",
    route: "/device",
    title: "Device & Capabilities",
    description: "Configure simulated device identity and hardware capabilities. Ensure firmware behavior correctly adapts to enabled or disabled modules like interlocks or sensors."
  },
  {
    id: "control",
    route: "/control",
    title: "Control, Status & Runtime",
    description: "Issue logical enable/disable requests, monitor deterministic state changes, and verify lifecycle counters and runtime accumulation operate strictly when output is active."
  },
  {
    id: "diagnostics",
    route: "/diagnostics",
    title: "Diagnostics & Protocol",
    description: "Inject communication faults, simulate storage failures, and inspect low-level bidirectional protocol transactions in real-time."
  },
  {
    id: "tests",
    route: "/tests",
    title: "Tests & Stress",
    description: "Run deterministic test suites against your firmware logic, and use the Stress tools to simulate high-frequency operational cycles and dropped packets."
  },
  {
    id: "firmware",
    route: "/firmware",
    title: "Firmware Update Simulation",
    description: "Rehearse firmware interruption and recovery scenarios. Validate metadata, handle transmission failures, and ensure safety logic persists across reboots."
  },
  {
    id: "profile",
    route: "/profile",
    title: "Profile & Modules",
    description: "Review the target device profile. Note that exact CIP assembly mappings and hardware endpoints remain TBD in this version and should not be invented."
  },
  {
    id: "logs",
    route: "/logs",
    title: "Logs & Exports",
    description: "Review comprehensive system logs. Export console state and transaction history for external analysis or sharing with the validation team."
  },
  {
    id: "settings",
    route: "/settings",
    title: "Settings",
    description: "Adjust simulation timing, developer modes, and local persistence. This concludes the primary workflow overview."
  },
  {
    id: "help",
    route: "/help",
    title: "Ready to Start",
    description: "You're all set. The detailed Programmer Guide provides in-depth documentation on expected simulation workflows and Hardware Mode lockouts. Let's go there now."
  }
];
