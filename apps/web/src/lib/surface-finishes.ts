export type SurfaceKind = "FACE" | "EDGE" | "WHOLE";
export type FinishKind = "ENAMEL" | "VENEER" | "COATING";

export type FinishAssignment = {
  itemId: string;
  surfaceKind: SurfaceKind;
  surfaceLabel: string;
  normalizedSurfaceLabel: string;
  layerOrder: number;
  finishKind: FinishKind;
  name: string;
  code: string;
  colorHex: string | null;
  sampleFileId: string | null;
};

const SURFACE_KINDS = new Set<SurfaceKind>(["FACE", "EDGE", "WHOLE"]);
const FINISH_KINDS = new Set<FinishKind>(["ENAMEL", "VENEER", "COATING"]);
const MAX_SURFACE_LABEL = 80;
const MAX_FINISH_TEXT = 160;
const MAX_ID_LENGTH = 200;
const MAX_LAYERS_PER_SURFACE = 20;
const MAX_ASSIGNMENTS_PER_ITEM = 120;
const MAX_ASSIGNMENTS_PER_REVISION = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  return /[\p{Cc}\u2028\u2029]/u.test(value);
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  if (hasControlCharacters(value)) throw new Error(`${field} contains control characters`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  if (Array.from(trimmed).length > maxLength) throw new Error(`${field} is too long`);
  return trimmed;
}

function nullableHex(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("colorHex must be a string or null");
  if (hasControlCharacters(value)) throw new Error("colorHex contains control characters");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^#[\da-fA-F]{6}$/.test(trimmed)) {
    throw new Error("colorHex must use #RRGGBB format");
  }
  return trimmed.toUpperCase();
}

function nullableSampleFileId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("sampleFileId must be a string or null");
  if (hasControlCharacters(value)) throw new Error("sampleFileId contains control characters");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (
    Array.from(trimmed).length > MAX_ID_LENGTH ||
    !/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(trimmed)
  ) {
    throw new Error("sampleFileId must be an opaque file ID, not a URL");
  }
  return trimmed;
}

export function normalizeFinishAssignment(input: unknown): FinishAssignment {
  if (!isRecord(input)) throw new Error("finish assignment must be an object");

  const itemId = requiredText(input.itemId, "itemId", MAX_ID_LENGTH);

  if (typeof input.surfaceKind !== "string" || !SURFACE_KINDS.has(input.surfaceKind as SurfaceKind)) {
    throw new Error("surfaceKind is invalid");
  }
  const surfaceKind = input.surfaceKind as SurfaceKind;
  let surfaceLabel: string;
  if (surfaceKind === "WHOLE") {
    if (typeof input.surfaceLabel !== "string") throw new Error("surfaceLabel must be a string");
    if (hasControlCharacters(input.surfaceLabel)) throw new Error("surfaceLabel contains control characters");
    if (Array.from(input.surfaceLabel.trim()).length > MAX_SURFACE_LABEL) throw new Error("surfaceLabel is too long");
    surfaceLabel = "Целиком";
  } else {
    surfaceLabel = requiredText(input.surfaceLabel, "surfaceLabel", MAX_SURFACE_LABEL)
      .normalize("NFKC")
      .trim();
    if (!surfaceLabel) throw new Error("surfaceLabel is required");
    if (Array.from(surfaceLabel).length > MAX_SURFACE_LABEL) throw new Error("surfaceLabel is too long");
    if (hasControlCharacters(surfaceLabel)) throw new Error("surfaceLabel contains control characters");
  }

  const layerOrder = input.layerOrder;
  if (typeof layerOrder !== "number" || !Number.isInteger(layerOrder) || layerOrder < 1 || layerOrder > MAX_LAYERS_PER_SURFACE) {
    throw new Error("layerOrder must be an integer from 1 to 20");
  }
  if (typeof input.finishKind !== "string" || !FINISH_KINDS.has(input.finishKind as FinishKind)) {
    throw new Error("finishKind is invalid");
  }

  const normalizedSurfaceLabel = surfaceLabel.normalize("NFKC").trim().toUpperCase();
  return {
    itemId,
    surfaceKind,
    surfaceLabel,
    normalizedSurfaceLabel,
    layerOrder,
    finishKind: input.finishKind as FinishKind,
    name: requiredText(input.name, "name", MAX_FINISH_TEXT),
    code: requiredText(input.code, "code", MAX_FINISH_TEXT),
    colorHex: nullableHex(input.colorHex),
    sampleFileId: nullableSampleFileId(input.sampleFileId),
  };
}

export function validateFinishAssignments(input: unknown[]): FinishAssignment[] {
  if (!Array.isArray(input)) throw new Error("finish assignments must be an array");
  if (input.length > MAX_ASSIGNMENTS_PER_REVISION) throw new Error("too many finish assignments in revision");

  const normalized: FinishAssignment[] = [];
  const itemCounts = new Map<string, number>();
  const uniqueLayers = new Set<string>();

  for (const rawAssignment of input) {
    const assignment = normalizeFinishAssignment(rawAssignment);
    const itemCount = (itemCounts.get(assignment.itemId) ?? 0) + 1;
    if (itemCount > MAX_ASSIGNMENTS_PER_ITEM) throw new Error("too many finish assignments for item");
    itemCounts.set(assignment.itemId, itemCount);

    const key = JSON.stringify([
      assignment.itemId,
      assignment.surfaceKind,
      assignment.normalizedSurfaceLabel,
      assignment.layerOrder,
    ]);
    if (uniqueLayers.has(key)) throw new Error("duplicate finish layer for surface");
    uniqueLayers.add(key);
    normalized.push(assignment);
  }

  return normalized;
}
