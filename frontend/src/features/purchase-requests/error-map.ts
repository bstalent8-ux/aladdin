type PgLike = { code?: string; message?: string };

/**
 * Database refusal -> translation key (never raw database text). The database is the authority; this
 * only names its outcomes. Specific lifecycle / validation fragments are tested BEFORE the generic
 * permission branch, because several are raised with the same SQLSTATE as a permission refusal and
 * collapsing them would tell someone they lack an authority they hold.
 */
export function mapRequestError(error: unknown): string {
  const e = (error ?? {}) as PgLike;
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();
  const k = (s: string) => `purchaseRequests.errors.${s}`;

  if (code === "VC001" || code === "40001" || msg.includes("modified concurrently")) return k("conflict");
  if (msg.includes("a request title is required")) return k("titleInvalid");
  if (msg.includes("notes are limited")) return k("notesTooLong");
  if (msg.includes("needed-by date")) return k("neededByPast");
  if (msg.includes("at most 30 items")) return k("tooManyItems");
  if (msg.includes("unknown or inactive product category")) return k("categoryInvalid");
  if (msg.includes("specifications are limited")) return k("specsTooLong");
  if (msg.includes("supported product units")) return k("unitInvalid");
  if (msg.includes("quantity must be") && !msg.includes("offered")) return k("quantityInvalid");
  if (msg.includes("an item name is required") || msg.includes("an item code is limited") || msg.includes("each item must be")) return k("itemInvalid");
  if (msg.includes("color")) return k("colorInvalid");
  if (msg.includes("only a showroom can share")) return k("shareShowroomOnly");
  if (msg.includes("organization type cannot publish")) return k("orgTypeNotAllowed");
  if (msg.includes("account type cannot publish")) return k("accountTypeNotAllowed");
  if (msg.includes("organization is not active")) return k("orgInactive");
  if (msg.includes("add at least one item")) return k("needsItem");
  if (msg.includes("a response needs at least one item")) return k("responseNeedsItem");
  if (msg.includes("only a draft")) return k("notDraft");
  if (msg.includes("only a published request can be closed")) return k("notPublished");
  if (msg.includes("can no longer be cancelled")) return k("notCancellable");
  if (msg.includes("at most 2 images")) return k("maxImages");
  if (msg.includes("unsupported content type")) return k("imageType");
  if (msg.includes("offered quantity must be")) return k("offeredInvalid");
  if (msg.includes("price must be")) return k("priceInvalid");
  if (msg.includes("unit must match")) return k("unitMismatch");
  if (msg.includes("does not belong to this request") || msg.includes("appears twice")) return k("responseItemInvalid");
  if (msg.includes("quantity and price must be numbers")) return k("responseItemInvalid");
  if (msg.includes("note is limited") || msg.includes("line note")) return k("noteTooLong");
  if (msg.includes("validity date")) return k("validityPast");
  if (msg.includes("was cancelled")) return k("cancelled");
  // Not-found is deliberate: it is also what an out-of-audience caller gets, so it never confirms existence.
  if (code === "P0002" || msg.includes("not found")) return k("notFound");
  if (code === "42501" || msg.includes("required") || msg.includes("not a member")) return k("denied");
  return "states.genericRetry";
}
