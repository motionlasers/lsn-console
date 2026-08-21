import type { Json } from "./profile-canonical.js";

/**
 * Derive a publication-readiness summary from a canonical profile document:
 * mapping completeness, partial-profile status, and limitations. Used to
 * display evidence before a Development publication is confirmed. This is
 * advisory metadata, not a safety-rated determination.
 */
export interface ProfileSummary {
  fieldCount: number;
  mappedFieldCount: number;
  mappingComplete: boolean;
  partial: boolean;
  limitations: string[];
  implementationStatus: Record<string, number>;
  simulationStatus: Record<string, number>;
}

function isObj(v: unknown): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasMapping(field: Record<string, Json>): boolean {
  const assembly = field["assembly"];
  const hasCip =
    field["cipService"] != null ||
    field["class"] != null ||
    field["instance"] != null ||
    field["attribute"] != null;
  const hasAssembly = assembly != null && isObj(assembly);
  return hasCip || hasAssembly;
}

export function summarizeProfile(document: unknown): ProfileSummary {
  const doc = isObj(document) ? document : {};
  const fields = Array.isArray(doc["fields"]) ? (doc["fields"] as Json[]) : [];

  let mapped = 0;
  const impl: Record<string, number> = {};
  const sim: Record<string, number> = {};
  const limitations: string[] = [];

  for (const f of fields) {
    if (!isObj(f)) continue;
    if (hasMapping(f)) mapped++;
    else {
      const name = typeof f["symbolicName"] === "string" ? f["symbolicName"] : "(unnamed)";
      limitations.push(`Field "${name}" has no CIP mapping`);
    }
    const is = typeof f["implementationStatus"] === "string" ? f["implementationStatus"] : "UNKNOWN";
    impl[is] = (impl[is] ?? 0) + 1;
    const ss = typeof f["simulationStatus"] === "string" ? f["simulationStatus"] : "UNKNOWN";
    sim[ss] = (sim[ss] ?? 0) + 1;
  }

  const notImplemented = fields.length - (impl["IMPLEMENTED"] ?? 0) - (impl["VERIFIED"] ?? 0);
  if (notImplemented > 0) {
    limitations.push(`${notImplemented} field(s) not yet IMPLEMENTED/VERIFIED`);
  }

  const mappingComplete = fields.length > 0 && mapped === fields.length;

  return {
    fieldCount: fields.length,
    mappedFieldCount: mapped,
    mappingComplete,
    partial: !mappingComplete || notImplemented > 0,
    limitations,
    implementationStatus: impl,
    simulationStatus: sim,
  };
}
