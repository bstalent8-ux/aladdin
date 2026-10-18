import { notFound } from "next/navigation";

/**
 * Offers are NOT part of the first Showroom release (rc1). The route answers 404 on the server, so a typed URL or an old
 * link cannot reach an unfinished surface. The database objects stay in place (later migrations depend on them) and
 * every offer RPC is still gated by the same approval rules. Remove this layout to enable Offers.
 */
export default function OffersNotInThisRelease(): never {
  notFound();
}
