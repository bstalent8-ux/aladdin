import Link from "next/link";
import type { FacetCategory, PublicCard, PublicPage, PublicSort } from "@/server/queries/marketplace-public";
import { PUBLIC_PAGE_SIZE, PUBLIC_SORTS } from "@/server/queries/marketplace-public";
import type { Locale } from "../marketplace-types";
import { fmtEgp, fmtNum, liveCopy } from "./live-copy";
import styles from "../marketplace.module.css";

export type CatalogParams = { category: string; type: string; q: string; sort: PublicSort; page: number };

function href(p: CatalogParams, patch: Partial<CatalogParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.category) sp.set("category", n.category);
  if (n.type) sp.set("type", n.type);
  if (n.q) sp.set("q", n.q);
  if (n.sort !== "newest") sp.set("sort", n.sort);
  if (n.page > 1) sp.set("page", String(n.page));
  const s = sp.toString();
  return s ? `/marketplace?${s}` : "/marketplace";
}

function name(o: { name_ar: string; name_en: string }, locale: Locale) {
  return (locale === "ar" ? o.name_ar : o.name_en) || o.name_ar || o.name_en;
}

function Card({ item, locale }: { item: PublicCard; locale: Locale }) {
  const t = liveCopy[locale];
  const title = name(item, locale);
  const typeName = locale === "ar" ? item.product_type_name_ar : item.product_type_name_en;
  return (
    <article className={styles.card} data-product-type={item.product_type_key}>
      <Link href={`/marketplace/products/${item.slug}`} className={styles.cardMedia} aria-label={title}>
        {item.image_id ? (
          // eslint-disable-next-line @next/next/no-img-element -- no-store proxy; next/image would re-cache it
          <img src={`/marketplace/media/${item.image_id}`} alt="" loading="lazy" className={styles.cardImage} style={{ width: "100%", height: "100%" }} />
        ) : (
          <span className="grid h-full place-items-center px-3 text-center text-[.8125rem] text-[var(--stone)]">{t.noImage}</span>
        )}
      </Link>
      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>
          <Link href={`/marketplace/products/${item.slug}`}>{title}</Link>
        </h3>
        <p className={styles.cardMeta}>
          {typeName}
          {item.variant_count > 1 ? ` · ${t.variants(fmtNum(item.variant_count, locale))}` : ""}
        </p>
        <p className={styles.cardMeta}>{t.soldBy(item.seller_name)}</p>
        {item.from_price_egp !== null ? (
          <p className={styles.cardPrice}>
            <span className={styles.from}>{item.variant_count > 1 ? `${t.from} ` : ""}</span>
            <strong>{fmtEgp(Number(item.from_price_egp), locale)}</strong>
          </p>
        ) : null}
        <p className={`${styles.stock} ${item.in_stock ? styles.stockIn : styles.stockOut}`}>
          {item.in_stock ? t.inStock : t.outOfStock}
        </p>
      </div>
    </article>
  );
}

/** Server-rendered, server-paginated public catalog. Filters are plain links and a GET form (works without JS). */
export function LiveCatalog({
  locale,
  params,
  page,
  facets,
}: {
  locale: Locale;
  params: CatalogParams;
  page: PublicPage | null;
  facets: FacetCategory[];
}) {
  const t = liveCopy[locale];
  const total = page ? Number(page.total) : 0;
  const pages = Math.max(1, Math.ceil(total / PUBLIC_PAGE_SIZE));
  const filtered = Boolean(params.category || params.type || params.q);
  const anyPublished = facets.some((c) => c.count > 0);

  return (
    <div className={styles.browser}>
      <div>
        <h1 className="m-0 text-[1.75rem]">{t.title}</h1>
        <p className="m-0 text-[var(--stone)]">{t.subtitle}</p>
      </div>

      <form method="get" action="/marketplace" className={styles.toolbar} role="search">
        {params.category ? <input type="hidden" name="category" value={params.category} /> : null}
        {params.type ? <input type="hidden" name="type" value={params.type} /> : null}
        <label className={styles.search}>
          <span className="sr-only">{t.search}</span>
          <input type="search" name="q" defaultValue={params.q} maxLength={100} placeholder={t.search} />
        </label>
        <label className={styles.sort}>
          {t.sort}
          <select name="sort" defaultValue={params.sort}>
            {PUBLIC_SORTS.map((s) => (
              <option key={s} value={s}>
                {t.sorts[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={styles.tab}>
          {t.searchButton}
        </button>
      </form>

      <div className={styles.layout}>
        <nav className={styles.panel} aria-label={t.categories}>
          <div className="grid gap-3">
            <Link href={href(params, { category: "", type: "", page: 1 })} className={!params.category && !params.type ? "font-bold" : undefined}>
              {t.allProducts}
            </Link>
            {facets
              .filter((c) => c.count > 0)
              .map((c) => (
                <div key={c.key} className="grid gap-1">
                  <Link
                    href={href(params, { category: c.key, type: "", page: 1 })}
                    className={params.category === c.key && !params.type ? "font-bold" : "font-semibold"}
                  >
                    {name(c, locale)} <span className="text-[var(--stone)]">({fmtNum(c.count, locale)})</span>
                  </Link>
                  <ul className="m-0 grid list-none gap-1 ps-3">
                    {c.types
                      .filter((ty) => ty.count > 0)
                      .map((ty) => (
                        <li key={ty.key}>
                          <Link
                            href={href(params, { category: c.key, type: ty.key, page: 1 })}
                            className={params.type === ty.key ? "font-bold" : "text-[var(--stone)]"}
                          >
                            {name(ty, locale)} ({fmtNum(ty.count, locale)})
                          </Link>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
          </div>
        </nav>

        <section className={styles.results} aria-live="polite">
          <div className={styles.resultsHead}>
            <p>{t.results(fmtNum(total, locale))}</p>
            <p>{t.taxNote}</p>
          </div>
          {!page || page.items.length === 0 ? (
            <div className={styles.empty}>
              <h2>{filtered || anyPublished ? t.noMatchTitle : t.emptyTitle}</h2>
              <p>{filtered || anyPublished ? t.noMatchBody : t.emptyBody}</p>
            </div>
          ) : (
            <ul className={styles.grid}>
              {page.items.map((item) => (
                <li key={item.slug}>
                  <Card item={item} locale={locale} />
                </li>
              ))}
            </ul>
          )}
          {pages > 1 ? (
            <nav className="flex items-center justify-center gap-3" aria-label={t.page(fmtNum(params.page, locale), fmtNum(pages, locale))}>
              {params.page > 1 ? (
                <Link className={styles.tab} href={href(params, { page: params.page - 1 })}>
                  {t.prev}
                </Link>
              ) : null}
              <span className="text-[.875rem] text-[var(--stone)]">{t.page(fmtNum(params.page, locale), fmtNum(pages, locale))}</span>
              {params.page < pages ? (
                <Link className={styles.tab} href={href(params, { page: params.page + 1 })}>
                  {t.next}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </section>
      </div>
    </div>
  );
}
