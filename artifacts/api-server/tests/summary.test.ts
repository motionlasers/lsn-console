import { describe, it, expect } from "vitest";
import { summarizeProfile } from "../src/lib/profile-summary.js";

describe("profile summary (publication readiness)", () => {
  it("reports full mapping completeness when all fields are mapped + implemented", () => {
    const doc = {
      fields: [
        { symbolicName: "a", cipService: "0x10", implementationStatus: "VERIFIED", simulationStatus: "VERIFIED" },
        { symbolicName: "b", class: 4, instance: 1, attribute: 3, implementationStatus: "IMPLEMENTED", simulationStatus: "VERIFIED" },
      ],
    };
    const s = summarizeProfile(doc);
    expect(s.fieldCount).toBe(2);
    expect(s.mappedFieldCount).toBe(2);
    expect(s.mappingComplete).toBe(true);
    expect(s.partial).toBe(false);
    expect(s.limitations).toHaveLength(0);
  });

  it("flags partial profiles and unmapped fields as limitations", () => {
    const doc = {
      fields: [
        { symbolicName: "a", cipService: "0x10", implementationStatus: "VERIFIED" },
        { symbolicName: "unmapped", implementationStatus: "TBD" },
      ],
    };
    const s = summarizeProfile(doc);
    expect(s.mappingComplete).toBe(false);
    expect(s.partial).toBe(true);
    expect(s.limitations.some((l) => l.includes("unmapped"))).toBe(true);
    expect(s.limitations.some((l) => /not yet IMPLEMENTED/.test(l))).toBe(true);
  });

  it("handles empty / malformed documents safely", () => {
    expect(summarizeProfile({}).fieldCount).toBe(0);
    expect(summarizeProfile(null).partial).toBe(true);
  });
});
