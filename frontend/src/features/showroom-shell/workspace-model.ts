import type { WorkspaceEntry } from "@/lib/workspace/model";

// Display labels only. Engineer businesses retain the canonical organization code.
export const SHOWROOM_BUSINESS_LABELS = {
  showroom_dealer: { ar: "المعرض", en: "Showroom" },
  supplier: { ar: "المورد", en: "Supplier" },
  manufacturer: { ar: "المصنع", en: "Manufacturer" },
  importer: { ar: "المستورد", en: "Importer" },
  design_office: { ar: "المهندس", en: "Engineer" },
} as const;
export type ShowroomBusinessType = keyof typeof SHOWROOM_BUSINESS_LABELS;
export function isShowroomBusinessType(value: string | null): value is ShowroomBusinessType {
  return value !== null && Object.hasOwn(SHOWROOM_BUSINESS_LABELS, value);
}
export function eligibleWorkspaces(entries: readonly WorkspaceEntry[]) {
  return entries.filter((entry): entry is Extract<WorkspaceEntry, { kind: "business" }> => entry.kind === "business" && isShowroomBusinessType(entry.orgType));
}
