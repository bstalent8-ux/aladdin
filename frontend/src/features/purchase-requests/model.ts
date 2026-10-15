import { countChars } from "@/lib/text/count-chars";
import { SHARED_UNITS, type SharedUnit } from "@/features/commerce/constants";

/**
 * Shared Purchase Requests - the pure model. Limits mirror the database (which stays the
 * authority and re-validates everything); parsing turns the readers' JSON into typed values.
 * No React, no Supabase.
 */

/** The units a request item can use: the same shared list the showroom product form offers. */
export const REQUEST_UNITS = SHARED_UNITS;
export type RequestUnit = SharedUnit;
export const isRequestUnit = (v: unknown): v is RequestUnit => typeof v === "string" && (REQUEST_UNITS as readonly string[]).includes(v);

export const REQUEST_LIMITS = {
  titleMin: 2,
  titleMax: 160,
  notesMax: 500,
  itemsMax: 30,
  nameMin: 2,
  nameMax: 160,
  codeMax: 80,
  specsMax: 250,
  quantityMax: 1_000_000,
  quantityDecimals: 3,
  priceMax: 100_000_000,
  priceDecimals: 2,
  imagesPerItem: 2,
  responseNoteMax: 500,
  lineNoteMax: 250,
} as const;

export type RequestColor = { name: string; hex: string | null; code?: string };

/** The audiences that DISCOVER requests; the others only post them. */
export const REQUEST_DISCOVERER_AUDIENCES = ["showroom_dealer", "supplier", "manufacturer", "importer"] as const;

// ---------------------------------------------------------------------------
// Numbers: exact text -> number, never a float computation
// ---------------------------------------------------------------------------
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** A positive decimal with at most `decimals` places, up to `max`. Arabic-Indic digits and separators are accepted as typed. */
export function parseDecimal(raw: unknown, decimals: number, max: number): number | null {
  if (typeof raw === "number") raw = String(raw);
  if (typeof raw !== "string") return null;
  const t = raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[٫,]/g, ".");
  // A fixed shape (no dynamic pattern); the decimal-places limit is checked on the fraction text.
  if (!/^\d{1,9}(\.\d+)?$/.test(t)) return null;
  if ((t.split(".")[1]?.length ?? 0) > decimals) return null;
  const n = Number(t);
  return n > 0 && n <= max ? n : null;
}

export const parseQuantity = (raw: unknown) => parseDecimal(raw, REQUEST_LIMITS.quantityDecimals, REQUEST_LIMITS.quantityMax);
export const parseUnitPrice = (raw: unknown) => parseDecimal(raw, REQUEST_LIMITS.priceDecimals, REQUEST_LIMITS.priceMax);

// ---------------------------------------------------------------------------
// Input validation (the friendly layer in front of the RPC)
// ---------------------------------------------------------------------------
export type RequestItemInput = {
  id?: string;
  name: string;
  code: string | null;
  categoryCode: string;
  colors: RequestColor[];
  quantity: number;
  unit: RequestUnit;
  specs: string | null;
};

export type RequestItemError = "name" | "category" | "quantity" | "unit" | "specs" | "code" | "colors";

const collapse = (v: string) => v.replace(/\s+/g, " ").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export function parseRequestItem(raw: unknown, isCategory: (code: string) => boolean): { ok: true; value: RequestItemInput } | { ok: false; error: RequestItemError } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = collapse(typeof o.name === "string" ? o.name : "");
  if (name.length < REQUEST_LIMITS.nameMin || name.length > REQUEST_LIMITS.nameMax) return { ok: false, error: "name" };
  const code = typeof o.code === "string" && collapse(o.code) !== "" ? collapse(o.code) : null;
  if (code && code.length > REQUEST_LIMITS.codeMax) return { ok: false, error: "code" };
  const categoryCode = typeof o.categoryCode === "string" ? o.categoryCode : "";
  if (!isCategory(categoryCode)) return { ok: false, error: "category" };
  const quantity = parseQuantity(o.quantity);
  if (quantity === null) return { ok: false, error: "quantity" };
  if (!isRequestUnit(o.unit)) return { ok: false, error: "unit" };
  const specs = typeof o.specs === "string" && o.specs.trim() !== "" ? o.specs.trim() : null;
  if (specs && countChars(specs) > REQUEST_LIMITS.specsMax) return { ok: false, error: "specs" };
  const colors: RequestColor[] = [];
  if (o.colors !== undefined && o.colors !== null) {
    if (!Array.isArray(o.colors)) return { ok: false, error: "colors" };
    for (const c of o.colors) {
      const cn = collapse(typeof c?.name === "string" ? c.name : "");
      if (!cn) continue;
      if (cn.length > 40) return { ok: false, error: "colors" };
      const hex = typeof c?.hex === "string" && c.hex !== "" ? c.hex : null;
      if (hex !== null && !/^#[0-9a-fA-F]{6}$/.test(hex)) return { ok: false, error: "colors" };
      colors.push({ name: cn, hex: hex ? hex.toUpperCase() : null, ...(typeof c?.code === "string" && c.code ? { code: c.code } : {}) });
    }
    if (colors.length > 12) return { ok: false, error: "colors" };
  }
  const id = isUuid(o.id) ? o.id : undefined;
  return { ok: true, value: { ...(id ? { id } : {}), name, code, categoryCode, colors, quantity, unit: o.unit, specs } };
}

/** The RPC's item payload (snake_case, as `request_item_normalize` reads it). */
export function toItemPayload(i: RequestItemInput) {
  return {
    ...(i.id ? { id: i.id } : {}),
    name: i.name,
    code: i.code ?? "",
    category_code: i.categoryCode,
    color_items: i.colors,
    quantity: i.quantity,
    unit: i.unit,
    specs: i.specs ?? "",
  };
}

export type ResponseLineInput = { requestItemId: string; offeredQuantity: number; unitPrice: number; note: string | null };

export function parseResponseLine(raw: unknown): { ok: true; value: ResponseLineInput } | { ok: false; error: "item" | "quantity" | "price" | "note" } {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (!isUuid(o.requestItemId)) return { ok: false, error: "item" };
  const offeredQuantity = parseQuantity(o.offeredQuantity);
  if (offeredQuantity === null) return { ok: false, error: "quantity" };
  const unitPrice = parseUnitPrice(o.unitPrice);
  if (unitPrice === null) return { ok: false, error: "price" };
  const note = typeof o.note === "string" && o.note.trim() !== "" ? o.note.trim() : null;
  if (note && countChars(note) > REQUEST_LIMITS.lineNoteMax) return { ok: false, error: "note" };
  return { ok: true, value: { requestItemId: o.requestItemId, offeredQuantity, unitPrice, note } };
}

export const toResponseLinePayload = (l: ResponseLineInput) => ({
  request_item_id: l.requestItemId,
  offered_quantity: l.offeredQuantity,
  unit_price: l.unitPrice,
  note: l.note ?? "",
});

// ---------------------------------------------------------------------------
// Reader projections (what the database returns)
// ---------------------------------------------------------------------------
export type RequestImage = { id: string; key: string; slot: number };
export type RequestItemView = {
  id: string;
  position: number;
  name: string;
  code: string | null;
  categoryCode: string;
  colors: RequestColor[];
  quantity: number;
  unit: string;
  specs: string | null;
  images: RequestImage[];
};
export type ResponseItemView = {
  requestItemId: string;
  requestedQuantity: number;
  unit: string;
  offeredQuantity: number;
  unitPrice: number;
  lineTotal: number;
  note: string | null;
};
export type ResponseView = {
  id: string;
  requestId: string;
  status: "submitted" | "withdrawn";
  coverage: "full" | "partial";
  currency: string;
  total: number;
  note: string | null;
  validUntil: string | null;
  shortlisted: boolean;
  submittedAt: string;
  responder: { id: string; name: string; verified: boolean; slug: string | null } | null;
  items: ResponseItemView[];
};
export type RequestDetailView = {
  id: string;
  title: string;
  notes: string | null;
  status: "draft" | "published" | "closed" | "cancelled";
  neededBy: string | null;
  publishedAt: string | null;
  requesterAudience: string;
  requester: { id: string; name: string; verified: boolean; slug: string | null } | null;
  canRespond: boolean;
  items: RequestItemView[];
  myResponse: ResponseView | null;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));

function parseOrgRef(v: unknown) {
  const o = obj(v);
  return typeof o.id === "string" ? { id: o.id, name: str(o.name) ?? "", verified: o.verified === true, slug: str(o.slug) } : null;
}

function parseColors(v: unknown): RequestColor[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((c) => {
    const o = obj(c);
    return typeof o.name === "string" ? [{ name: o.name, hex: str(o.hex), ...(typeof o.code === "string" ? { code: o.code } : {}) }] : [];
  });
}

export function parseRequestItems(v: unknown): RequestItemView[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    const o = obj(raw);
    if (typeof o.id !== "string") return [];
    const images = Array.isArray(o.images)
      ? o.images.flatMap((m) => {
          const i = obj(m);
          return typeof i.id === "string" && typeof i.key === "string" ? [{ id: i.id, key: i.key, slot: num(i.slot) }] : [];
        })
      : [];
    return [{ id: o.id, position: num(o.position), name: str(o.name) ?? "", code: str(o.code), categoryCode: str(o.category_code) ?? "", colors: parseColors(o.color_items), quantity: num(o.quantity), unit: str(o.unit) ?? "", specs: str(o.specs), images }];
  });
}

export function parseResponse(raw: unknown): ResponseView | null {
  const o = obj(raw);
  if (typeof o.id !== "string") return null;
  const items = Array.isArray(o.items)
    ? o.items.flatMap((r) => {
        const i = obj(r);
        return typeof i.request_item_id === "string"
          ? [{ requestItemId: i.request_item_id, requestedQuantity: num(i.requested_quantity), unit: str(i.unit) ?? "", offeredQuantity: num(i.offered_quantity), unitPrice: num(i.unit_price), lineTotal: num(i.line_total), note: str(i.note) }]
          : [];
      })
    : [];
  return {
    id: o.id,
    requestId: str(o.request_id) ?? "",
    status: o.status === "withdrawn" ? "withdrawn" : "submitted",
    coverage: o.coverage === "full" ? "full" : "partial",
    currency: str(o.currency) ?? "EGP",
    total: num(o.total),
    note: str(o.note),
    validUntil: str(o.valid_until),
    shortlisted: o.shortlisted === true,
    submittedAt: str(o.submitted_at) ?? "",
    responder: parseOrgRef(o.responder),
    items,
  };
}

export function parseRequestDetail(raw: unknown): RequestDetailView | null {
  const o = obj(raw);
  if (typeof o.id !== "string") return null;
  const status = o.status;
  return {
    id: o.id,
    title: str(o.title) ?? "",
    notes: str(o.notes),
    status: status === "draft" || status === "closed" || status === "cancelled" ? status : "published",
    neededBy: str(o.needed_by),
    publishedAt: str(o.published_at),
    requesterAudience: str(o.requester_audience) ?? "",
    requester: parseOrgRef(o.requester),
    canRespond: o.can_respond === true,
    items: parseRequestItems(o.items),
    myResponse: parseResponse(o.my_response),
  };
}

/** Cheapest-first comparison order with the shortlist on top - what the requester reads. */
export function compareResponses(a: ResponseView, b: ResponseView): number {
  if (a.shortlisted !== b.shortlisted) return a.shortlisted ? -1 : 1;
  return a.total - b.total;
}
