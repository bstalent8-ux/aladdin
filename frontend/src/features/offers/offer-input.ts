import { DESCRIPTION_MAX_CHARS } from "@/features/commerce/constants";
import { countChars } from "@/lib/text/count-chars";
import { parsePrice } from "@/features/showroom-shell/products/product-input";
import { zonedToUtcIso } from "./offer-datetime";
import { isAudienceCode, type OfferAudienceCode } from "./offer-model";

export const OFFER_LIMITS = { titleMin: 2, titleMax: 100, descriptionMax: DESCRIPTION_MAX_CHARS, items: 50, quantityMax: 100_000 } as const;

export type OfferFormValue = {
  title: string;
  description: string | null;
  totalPrice: number;
  referencePrice: number | null;
  startsAt: string;
  endsAt: string;
  items: Array<{ productId: string; quantity: number }>;
  audiences: OfferAudienceCode[];
};

export type OfferFormResult = { ok: true; value: OfferFormValue } | { ok: false; fieldErrors: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/**
 * The builder form -> a validated payload. This is the first line of defence and the user's
 * feedback; the database validates every rule again (price, window, items, quantities,
 * ownership, audiences), so nothing here is trusted.
 */
export function parseOfferForm(fd: FormData, zone: string): OfferFormResult {
  const errors: Record<string, string> = {};

  const title = text(fd, "title").replace(/\s+/g, " ").trim();
  if (title.length < OFFER_LIMITS.titleMin || title.length > OFFER_LIMITS.titleMax) errors.title = "showroomOffers.errors.title";
  const descriptionRaw = text(fd, "description").replace(/\r\n?/g, "\n").trim();
  if (countChars(descriptionRaw) > OFFER_LIMITS.descriptionMax) errors.description = "showroomOffers.errors.description";

  const price = parsePrice(text(fd, "totalPrice"));
  if (!price.ok) errors.totalPrice = "showroomOffers.errors.price";
  let referencePrice: number | null = null;
  const refRaw = text(fd, "referencePrice").trim();
  if (refRaw !== "") {
    const ref = parsePrice(refRaw);
    if (!ref.ok) errors.referencePrice = "showroomOffers.errors.price";
    else if (price.ok && ref.value <= price.value) errors.referencePrice = "showroomOffers.errors.priceBefore";
    else referencePrice = ref.value;
  }

  const startsAt = zonedToUtcIso(text(fd, "startDate"), text(fd, "startTime"), zone);
  const endsAt = zonedToUtcIso(text(fd, "endDate"), text(fd, "endTime"), zone);
  if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) errors.dates = "showroomOffers.errors.dates";

  let items: OfferFormValue["items"] = [];
  try {
    const raw: unknown = JSON.parse(text(fd, "items") || "[]");
    if (!Array.isArray(raw)) throw new Error("not a list");
    const seen = new Set<string>();
    items = raw.map((entry) => {
      const e = (entry ?? {}) as { productId?: unknown; quantity?: unknown };
      const productId = typeof e.productId === "string" && UUID.test(e.productId) ? e.productId : null;
      const quantity = typeof e.quantity === "number" ? e.quantity : NaN;
      if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > OFFER_LIMITS.quantityMax || seen.has(productId)) {
        throw new Error("bad item");
      }
      seen.add(productId);
      return { productId, quantity };
    });
    if (items.length === 0 || items.length > OFFER_LIMITS.items) throw new Error("count");
  } catch {
    errors.items = "showroomOffers.errors.items";
  }

  const audiences = [...new Set(fd.getAll("audience").filter((v): v is string => typeof v === "string"))];
  if (audiences.length === 0 || !audiences.every(isAudienceCode)) errors.audiences = "showroomOffers.errors.audiences";

  if (Object.keys(errors).length > 0 || !price.ok || !startsAt || !endsAt) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    value: {
      title,
      description: descriptionRaw === "" ? null : descriptionRaw,
      totalPrice: price.value,
      referencePrice,
      startsAt,
      endsAt,
      items,
      audiences: audiences as OfferAudienceCode[],
    },
  };
}

/** Database refusal -> translation key. Never raw database text. */
export function mapOfferError(error: unknown): { code: string; field?: string } {
  const e = (error ?? {}) as { code?: string; message?: string };
  const msg = (e.message ?? "").toLowerCase();
  if (e.code === "40001" || msg.includes("modified concurrently")) return { code: "showroomOffers.errors.conflict" };
  if (e.code === "P0002" || msg.includes("offer not found")) return { code: "showroomOffers.errors.notFound" };
  if (e.code === "42501" || msg.includes("required") || msg.includes("not a member")) return { code: "showroomOffers.errors.denied" };
  if (msg.includes("offer name")) return { code: "showroomOffers.errors.title", field: "title" };
  if (msg.includes("description is limited")) return { code: "showroomOffers.errors.description", field: "description" };
  if (msg.includes("price before")) return { code: "showroomOffers.errors.priceBefore", field: "referencePrice" };
  if (msg.includes("package price")) return { code: "showroomOffers.errors.price", field: "totalPrice" };
  if (msg.includes("already ended")) return { code: "showroomOffers.errors.ended", field: "dates" };
  if (msg.includes("end after it starts")) return { code: "showroomOffers.errors.dates", field: "dates" };
  if (msg.includes("every product in a published offer")) return { code: "showroomOffers.errors.productsNotPublished", field: "items" };
  if (msg.includes("active product of your organization")) return { code: "showroomOffers.errors.itemsInvalid", field: "items" };
  if (msg.includes("at least one product") || msg.includes("quantity") || msg.includes("only once") || msg.includes("offer item")) {
    return { code: "showroomOffers.errors.items", field: "items" };
  }
  if (msg.includes("cannot receive offers")) return { code: "showroomOffers.errors.audienceNotReady", field: "audiences" };
  if (msg.includes("audience")) return { code: "showroomOffers.errors.audiences", field: "audiences" };
  if (msg.includes("can be edited") || msg.includes("pause a published")) return { code: "showroomOffers.errors.notEditable" };
  if (e.code === "22023") return { code: "showroomOffers.errors.invalidAction" };
  return { code: "showroomOffers.errors.generic" };
}
