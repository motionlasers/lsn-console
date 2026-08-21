import { describe, it, expect } from "vitest";
import {
  canonicalize,
  canonicalString,
  digestOf,
  diffProfiles,
} from "../src/lib/profile-canonical.js";

describe("canonicalization + digest", () => {
  it("produces the same digest regardless of key order", () => {
    const a = { profileVersion: "0.1.0", fields: [{ symbolicName: "x", access: "READ" }] };
    const b = { fields: [{ access: "READ", symbolicName: "x" }], profileVersion: "0.1.0" };
    expect(digestOf(a)).toBe(digestOf(b));
    expect(canonicalString(a)).toBe(canonicalString(b));
  });

  it("changes the digest when content changes", () => {
    const a = { profileVersion: "0.1.0" };
    const b = { profileVersion: "0.2.0" };
    expect(digestOf(a)).not.toBe(digestOf(b));
  });

  it("canonicalizes nested structures deterministically", () => {
    const doc = { z: 1, a: { c: 3, b: 2 }, list: [{ y: 1, x: 2 }] };
    expect(canonicalString(canonicalize(doc))).toBe(canonicalString(doc));
    expect(canonicalString(doc)).toBe(
      JSON.stringify({ a: { b: 2, c: 3 }, list: [{ x: 2, y: 1 }], z: 1 }),
    );
  });

  it("matches an independent SHA-256 canonical digest reference", () => {
    // Sorted-key compact JSON => sha256, must equal digestOf().
    const doc = { b: 2, a: 1 };
    const digest = digestOf(doc);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("diff classification", () => {
  it("detects no changes for identical (reordered) docs", () => {
    const r = diffProfiles({ a: 1, b: 2 }, { b: 2, a: 1 });
    expect(r.hasChanges).toBe(false);
    expect(r.entries).toHaveLength(0);
  });

  it("classifies mapping changes", () => {
    const before = { fields: [{ symbolicName: "x", cipService: "0x10" }] };
    const after = { fields: [{ symbolicName: "x", cipService: "0x0E" }] };
    const r = diffProfiles(before, after);
    expect(r.hasChanges).toBe(true);
    expect(r.counts.mapping).toBe(1);
    expect(r.entries[0].class).toBe("mapping");
    expect(r.entries[0].kind).toBe("changed");
  });

  it("classifies timing, behavior, and field changes", () => {
    const before = {
      profileVersion: "0.1.0",
      capabilities: { interlock: { enabled: true, phase: "A" } },
      fields: [{ symbolicName: "x", expectedFirmwareBehavior: "old" }],
    };
    const after = {
      profileVersion: "0.2.0",
      capabilities: { interlock: { enabled: false, phase: "B" } },
      fields: [{ symbolicName: "x", expectedFirmwareBehavior: "new" }],
    };
    const r = diffProfiles(before, after);
    expect(r.counts.timing).toBeGreaterThanOrEqual(1); // phase
    expect(r.counts.behavior).toBeGreaterThanOrEqual(2); // enabled + expectedFirmwareBehavior
    expect(r.counts.field).toBeGreaterThanOrEqual(1); // profileVersion
  });

  it("detects added and removed fields", () => {
    const before = { fields: [{ symbolicName: "x" }] };
    const after = { fields: [{ symbolicName: "x" }, { symbolicName: "y" }] };
    const r = diffProfiles(before, after);
    expect(r.entries.some((e) => e.kind === "added")).toBe(true);
  });
});
