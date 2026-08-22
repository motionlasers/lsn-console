import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import {
  validateDeviceProfile,
  type DeviceProfileDocument,
  type DeviceProfileField,
} from "@/lib/profile-validation";

const DIRECTIONS: DeviceProfileField["direction"][] = ["PC_TO_LSN", "LSN_TO_PC"];
const ACCESS: DeviceProfileField["access"][] = ["READ", "WRITE", "READ_WRITE"];
const FW_STATUSES: DeviceProfileField["implementationStatus"][] = ["TBD", "IMPLEMENTING", "TESTING", "IMPLEMENTED", "VERIFIED"];
const SIM_STATUSES: DeviceProfileField["simulationStatus"][] = ["NOT_TESTED", "TESTING", "VERIFIED"];
const CAPABILITY_KEYS = ["interlock", "remoteStop", "sensors"] as const;

interface DeviceProfileEditorProps {
  document: DeviceProfileDocument;
  onChange: (next: DeviceProfileDocument) => void;
  readOnly?: boolean;
}

const inputClass =
  "h-8 bg-black/40 border-border/60 font-mono text-xs text-foreground focus-visible:ring-primary/40";
const labelClass = "text-[10px] uppercase font-mono tracking-widest text-muted-foreground";

function toIntOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return /^-?\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
}

function intFieldValue(value: unknown): string {
  return value == null ? "" : String(value);
}

function assemblyValue(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Full supported Device Profile document editor for Firmware Admins. Exposes
 * every top-level, identity, timing, capability, and interface field. This is
 * not gated behind devMode: it is the normal Firmware Admin editing surface.
 *
 * Simulation-only future capability fields (interlock/remoteStop/sensors) are
 * clearly labeled and their enabled toggle only mutates the profile document —
 * it never silently enables them in the active Phase 1 runtime.
 */
export function DeviceProfileEditor({ document, onChange, readOnly = false }: DeviceProfileEditorProps) {
  const validation = useMemo(() => validateDeviceProfile(document), [document]);

  const patch = (next: Partial<DeviceProfileDocument>) => {
    if (readOnly) return;
    onChange({ ...document, ...next });
  };

  const patchIdentity = (key: string, value: unknown) => {
    patch({ identity: { ...(document.identity ?? {}), [key]: value } });
  };

  const patchTiming = (key: string, value: unknown) => {
    patch({ timing: { ...(document.timing ?? {}), [key]: value } });
  };

  const patchCapability = (key: string, next: Partial<{ enabled: boolean; phase: string; description: string }>) => {
    const existing = document.capabilities[key] ?? { enabled: false, phase: "future", description: "" };
    patch({ capabilities: { ...document.capabilities, [key]: { ...existing, ...next } } });
  };

  const patchField = (index: number, next: Partial<DeviceProfileField>) => {
    const fields = document.fields.map((field, i) => (i === index ? { ...field, ...next } : field));
    patch({ fields });
  };

  const addField = () => {
    const newField: DeviceProfileField = {
      symbolicName: "NewField",
      direction: "LSN_TO_PC",
      dataType: "boolean",
      access: "READ",
      cipService: "TBD",
      class: null,
      instance: null,
      attribute: null,
      assembly: null,
      implementationStatus: "TBD",
      simulationStatus: "NOT_TESTED",
      description: "",
      expectedFirmwareBehavior: "",
      expectedReportedResponse: "",
      notes: "",
    };
    patch({ fields: [...document.fields, newField] });
  };

  const removeField = (index: number) => {
    patch({ fields: document.fields.filter((_, i) => i !== index) });
  };

  const identity = (document.identity ?? {}) as Record<string, unknown>;
  const timing = (document.timing ?? {}) as Record<string, unknown>;

  return (
    <div className="flex flex-col gap-6" data-testid="device-profile-editor">
      {!validation.valid && (
        <div
          className="border border-destructive/50 bg-destructive/10 p-3 font-mono text-xs text-destructive"
          data-testid="profile-validation-errors"
        >
          <div className="mb-2 flex items-center gap-2 font-bold uppercase tracking-widest">
            <AlertTriangle className="h-4 w-4" /> Profile is invalid — resolve before saving or submitting
          </div>
          <ul className="list-disc space-y-1 pl-5">
            {validation.errors.map((error, i) => (
              <li key={i} data-testid={`profile-validation-error-${i}`}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Top-level metadata */}
      <Card className="border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary">Profile Metadata</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 pt-4 md:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Profile Version</span>
            <Input className={inputClass} readOnly={readOnly} value={document.profileVersion ?? ""} onChange={e => patch({ profileVersion: e.target.value })} data-testid="input-profile-version" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Protocol Version</span>
            <Input className={inputClass} readOnly={readOnly} value={document.protocolVersion ?? ""} onChange={e => patch({ protocolVersion: e.target.value })} data-testid="input-protocol-version" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Display Name</span>
            <Input className={inputClass} readOnly={readOnly} value={document.displayName ?? ""} onChange={e => patch({ displayName: e.target.value })} data-testid="input-display-name" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Hardware Family</span>
            <Input className={inputClass} readOnly={readOnly} value={document.hardwareFamily ?? ""} onChange={e => patch({ hardwareFamily: e.target.value })} data-testid="input-hardware-family" />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={labelClass}>Supported Firmware (comma-separated)</span>
            <Input
              className={inputClass}
              readOnly={readOnly}
              value={(document.supportedFirmware ?? []).join(", ")}
              onChange={e => patch({ supportedFirmware: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
              data-testid="input-supported-firmware"
            />
          </label>
        </CardContent>
      </Card>

      {/* Identity */}
      <Card className="border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary">CIP Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 pt-4 md:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Vendor ID</span>
            <Input className={inputClass} readOnly={readOnly} value={intFieldValue(identity.vendorId)} onChange={e => patchIdentity("vendorId", toIntOrNull(e.target.value))} data-testid="input-identity-vendor-id" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Device Type</span>
            <Input className={inputClass} readOnly={readOnly} value={intFieldValue(identity.deviceType)} onChange={e => patchIdentity("deviceType", toIntOrNull(e.target.value))} data-testid="input-identity-device-type" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Product Code</span>
            <Input className={inputClass} readOnly={readOnly} value={intFieldValue(identity.productCode)} onChange={e => patchIdentity("productCode", toIntOrNull(e.target.value))} data-testid="input-identity-product-code" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Product Name</span>
            <Input className={inputClass} readOnly={readOnly} value={String(identity.productName ?? "")} onChange={e => patchIdentity("productName", e.target.value)} data-testid="input-identity-product-name" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Mapping State</span>
            <Input className={inputClass} readOnly={readOnly} value={String(identity.mappingState ?? "")} onChange={e => patchIdentity("mappingState", e.target.value)} data-testid="input-identity-mapping-state" />
          </label>
        </CardContent>
      </Card>

      {/* Timing */}
      <Card className="border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary">Timing</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 pt-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Explicit Msg Timeout (ms)</span>
            <Input className={inputClass} readOnly={readOnly} value={intFieldValue(timing.explicitMessageTimeoutMs)} onChange={e => patchTiming("explicitMessageTimeoutMs", toIntOrNull(e.target.value))} data-testid="input-timing-timeout" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Reconnect Interval / RPI (ms)</span>
            <Input className={inputClass} readOnly={readOnly} value={intFieldValue(timing.reconnectIntervalMs)} onChange={e => patchTiming("reconnectIntervalMs", toIntOrNull(e.target.value))} data-testid="input-timing-rpi" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Runtime Tolerance (ms)</span>
            <Input className={inputClass} readOnly={readOnly} value={intFieldValue(timing.runtimeToleranceMs)} onChange={e => patchTiming("runtimeToleranceMs", toIntOrNull(e.target.value))} data-testid="input-timing-tolerance" />
          </label>
        </CardContent>
      </Card>

      {/* Capabilities */}
      <Card className="border-warning/40 bg-warning/5 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-warning">
            Future Capabilities (Simulation-Only Metadata)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-4">
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            These capabilities describe future hardware features. Enabling one here edits the profile metadata only;
            it does not enable the capability in the active Phase 1 runtime. Capability-tagged fields stay hidden from
            the live interface until the runtime capability model opts in.
          </p>
          {CAPABILITY_KEYS.map(key => {
            const cap = document.capabilities[key] ?? { enabled: false, phase: "future", description: "" };
            return (
              <div key={key} className="grid grid-cols-1 gap-3 border border-border/50 bg-black/20 p-3 md:grid-cols-[auto_1fr_2fr]" data-testid={`capability-row-${key}`}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(cap.enabled)}
                    disabled={readOnly}
                    onChange={e => patchCapability(key, { enabled: e.target.checked })}
                    data-testid={`checkbox-capability-${key}`}
                  />
                  <span className="font-mono text-xs uppercase tracking-widest text-foreground">{key}</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Phase</span>
                  <Input className={inputClass} readOnly={readOnly} value={String(cap.phase ?? "")} onChange={e => patchCapability(key, { phase: e.target.value })} data-testid={`input-capability-phase-${key}`} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Description</span>
                  <Input className={inputClass} readOnly={readOnly} value={String(cap.description ?? "")} onChange={e => patchCapability(key, { description: e.target.value })} data-testid={`input-capability-description-${key}`} />
                </label>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Fields */}
      <Card className="border-border bg-card/50 backdrop-blur">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary">Interface Fields</CardTitle>
          {!readOnly && (
            <Button size="sm" variant="outline" className="h-7 font-mono text-[10px]" onClick={addField} data-testid="button-add-field">
              <Plus className="mr-2 h-3 w-3" /> ADD FIELD
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-4">
          {document.fields.map((field, index) => (
            <DeviceProfileFieldEditor
              key={index}
              index={index}
              field={field}
              readOnly={readOnly}
              onChange={next => patchField(index, next)}
              onRemove={() => removeField(index)}
            />
          ))}
          {document.fields.length === 0 && (
            <div className="border border-dashed border-border py-8 text-center font-mono text-xs text-muted-foreground">
              No fields defined.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface FieldEditorProps {
  index: number;
  field: DeviceProfileField;
  readOnly: boolean;
  onChange: (next: Partial<DeviceProfileField>) => void;
  onRemove: () => void;
}

function DeviceProfileFieldEditor({ index, field, readOnly, onChange, onRemove }: FieldEditorProps) {
  const selectClass =
    "h-8 bg-black/40 border border-border/60 rounded-sm font-mono text-xs text-foreground px-2 focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-70";
  return (
    <div className="border border-border/60 bg-black/20 p-3" data-testid={`field-editor-${index}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-xs font-bold text-foreground/90">
          {field.capability && (
            <span className="mr-2 rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-warning">
              SIM-ONLY: {field.capability}
            </span>
          )}
          {field.symbolicName || "(unnamed)"}
        </span>
        {!readOnly && (
          <Button size="sm" variant="ghost" className="h-7 font-mono text-[10px] text-destructive hover:bg-destructive/10" onClick={onRemove} data-testid={`button-remove-field-${index}`}>
            <Trash2 className="mr-1 h-3 w-3" /> REMOVE
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Symbolic Name</span>
          <Input className={inputClass} readOnly={readOnly} value={field.symbolicName} onChange={e => onChange({ symbolicName: e.target.value })} data-testid={`input-field-name-${index}`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Direction</span>
          <select className={selectClass} disabled={readOnly} value={field.direction} onChange={e => onChange({ direction: e.target.value as DeviceProfileField["direction"] })} data-testid={`select-field-direction-${index}`}>
            {DIRECTIONS.map(d => <option key={d} value={d} className="bg-background">{d}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Data Type</span>
          <Input className={inputClass} readOnly={readOnly} value={field.dataType} onChange={e => onChange({ dataType: e.target.value })} data-testid={`input-field-datatype-${index}`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Access</span>
          <select className={selectClass} disabled={readOnly} value={field.access} onChange={e => onChange({ access: e.target.value as DeviceProfileField["access"] })} data-testid={`select-field-access-${index}`}>
            {ACCESS.map(a => <option key={a} value={a} className="bg-background">{a}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>CIP Service</span>
          <Input className={inputClass} readOnly={readOnly} value={field.cipService ?? ""} onChange={e => onChange({ cipService: e.target.value === "" ? null : e.target.value })} data-testid={`input-field-cipservice-${index}`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Class</span>
          <Input className={inputClass} readOnly={readOnly} value={intFieldValue(field.class)} onChange={e => onChange({ class: toIntOrNull(e.target.value) })} data-testid={`input-field-class-${index}`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Instance</span>
          <Input className={inputClass} readOnly={readOnly} value={intFieldValue(field.instance)} onChange={e => onChange({ instance: toIntOrNull(e.target.value) })} data-testid={`input-field-instance-${index}`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Attribute</span>
          <Input className={inputClass} readOnly={readOnly} value={intFieldValue(field.attribute)} onChange={e => onChange({ attribute: toIntOrNull(e.target.value) })} data-testid={`input-field-attribute-${index}`} />
        </label>

        <label className="flex flex-col gap-1 md:col-span-2">
          <span className={labelClass}>Assembly (JSON)</span>
          <Input
            className={inputClass}
            readOnly={readOnly}
            value={assemblyValue(field.assembly)}
            onChange={e => {
              const raw = e.target.value.trim();
              if (raw === "") { onChange({ assembly: null }); return; }
              try {
                const parsed = JSON.parse(raw);
                onChange({ assembly: parsed && typeof parsed === "object" ? parsed : null });
              } catch {
                onChange({ assembly: raw as unknown as Record<string, unknown> });
              }
            }}
            data-testid={`input-field-assembly-${index}`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Byte</span>
          <Input className={inputClass} readOnly={readOnly} value={intFieldValue(field.byte)} onChange={e => onChange({ byte: toIntOrNull(e.target.value) ?? undefined })} data-testid={`input-field-byte-${index}`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Bit</span>
          <Input className={inputClass} readOnly={readOnly} value={intFieldValue(field.bit)} onChange={e => onChange({ bit: toIntOrNull(e.target.value) ?? undefined })} data-testid={`input-field-bit-${index}`} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Units</span>
          <Input className={inputClass} readOnly={readOnly} value={field.units ?? ""} onChange={e => onChange({ units: e.target.value === "" ? undefined : e.target.value })} data-testid={`input-field-units-${index}`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Capability (Sim-Only)</span>
          <select
            className={selectClass}
            disabled={readOnly}
            value={field.capability ?? ""}
            onChange={e => onChange({ capability: (e.target.value || undefined) as DeviceProfileField["capability"] })}
            data-testid={`select-field-capability-${index}`}
          >
            <option value="" className="bg-background">(none / active)</option>
            {CAPABILITY_KEYS.map(c => <option key={c} value={c} className="bg-background">{c}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Firmware Status</span>
          <select className={selectClass} disabled={readOnly} value={field.implementationStatus} onChange={e => onChange({ implementationStatus: e.target.value as DeviceProfileField["implementationStatus"] })} data-testid={`select-field-fw-status-${index}`}>
            {FW_STATUSES.map(s => <option key={s} value={s} className="bg-background">{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Simulation Status</span>
          <select className={selectClass} disabled={readOnly} value={field.simulationStatus} onChange={e => onChange({ simulationStatus: e.target.value as DeviceProfileField["simulationStatus"] })} data-testid={`select-field-sim-status-${index}`}>
            {SIM_STATUSES.map(s => <option key={s} value={s} className="bg-background">{s}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1 md:col-span-2 lg:col-span-4">
          <span className={labelClass}>Description</span>
          <Textarea className="min-h-[48px] bg-black/40 border-border/60 font-mono text-xs" readOnly={readOnly} value={field.description ?? ""} onChange={e => onChange({ description: e.target.value })} data-testid={`textarea-field-description-${index}`} />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2 lg:col-span-4">
          <span className={labelClass}>Expected Firmware Behavior</span>
          <Textarea className="min-h-[48px] bg-black/40 border-border/60 font-mono text-xs" readOnly={readOnly} value={field.expectedFirmwareBehavior} onChange={e => onChange({ expectedFirmwareBehavior: e.target.value })} data-testid={`textarea-field-behavior-${index}`} />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2 lg:col-span-4">
          <span className={labelClass}>Expected Reported Response</span>
          <Textarea className="min-h-[48px] bg-black/40 border-border/60 font-mono text-xs" readOnly={readOnly} value={field.expectedReportedResponse} onChange={e => onChange({ expectedReportedResponse: e.target.value })} data-testid={`textarea-field-response-${index}`} />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2 lg:col-span-4">
          <span className={labelClass}>Notes</span>
          <Textarea className="min-h-[48px] bg-black/40 border-border/60 font-mono text-xs" readOnly={readOnly} value={field.notes ?? ""} onChange={e => onChange({ notes: e.target.value })} data-testid={`textarea-field-notes-${index}`} />
        </label>
      </div>
    </div>
  );
}
