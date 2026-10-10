import { mapCommerceError } from "@/server/actions/error-mapping";

type PgLike = { code?: string; message?: string };

/**
 * Database refusal -> translation key (never raw database text). The database is
 * the authority; this only names its outcomes in the user's language. Anything it
 * does not recognise falls through to the shared commerce mapper (permission,
 * stale version, generic retry).
 */
export function mapOwnProductError(error: unknown): { code: string; field?: "code" | "category" | "unit" | "price" | "description" | "colors" } {
  const e = (error ?? {}) as PgLike;
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();

  if (code === "40001" || msg.includes("modified concurrently")) return { code: "commerce.errors.conflict" };
  if (code === "23505" || msg.includes("already used in your organization")) {
    return { code: "showroomProducts.errors.duplicateCode", field: "code" };
  }
  if (msg.includes("at most 3 images")) return { code: "showroomProducts.errors.maxImages" };
  if (msg.includes("unknown or inactive product category")) return { code: "showroomProducts.errors.categoryInvalid", field: "category" };
  if (msg.includes("supported product units")) return { code: "showroomProducts.errors.unitInvalid", field: "unit" };
  if (msg.includes("250 characters")) return { code: "showroomProducts.validation.descriptionChars", field: "description" };
  if (msg.includes("price cannot be removed")) return { code: "showroomProducts.validation.priceRequired", field: "price" };
  if (msg.includes("price must be")) return { code: "showroomProducts.validation.priceInvalid", field: "price" };
  if (msg.includes("hex code")) return { code: "showroomProducts.validation.colorHexInvalid", field: "colors" };
  if (msg.includes("archived product")) return { code: "showroomProducts.errors.archived" };
  if (code === "42501" || msg.includes("required") || msg.includes("not a member")) return { code: "commerce.errors.denied" };
  if (code === "22023") return { code: "showroomProducts.errors.invalid" };
  return { code: mapCommerceError(error) };
}
