# Showroom V2 Home - metric definitions and data sources

Every figure is read through the caller's own RLS-bound client for the ACTIVE organization. Period = the Home period selector (default last 30 days), converted to the organization's own timezone (`lib/workspace/zoned-range.ts`, same window as `showroom_home_metrics`).

| Card | Definition | Source | Gate (same as its destination) |
|---|---|---|---|
| Active Direct RFQs | RFQs this organization SENT with status `submitted` or `quoted` (now) | `rfq_list` | `rfq.create` |
| Supplier quotations received | Non-draft quotations addressed to this organization created in the period | `showroom_home_metrics.quotes_received` | `quote.decide` or `rfq.create` |
| Purchase orders in progress | Orders placed by this organization with status `confirmed`/`in_progress` (now) | `showroom_home_metrics.purchase_orders_active` | order capabilities |
| Completed orders | Orders placed by this organization, status `completed`, `completed_at` in the period | `order_list` | order capabilities |
| Total purchases | Sum of `total` of non-cancelled orders confirmed in the period | `showroom_home_metrics.total_purchases` | order capabilities |
| Sixth card | Customer RFQs received (seller capability) else Saved products | `showroom_home_metrics` | `rfq.respond` / browse capabilities |

Further figures (RFQs sent, customer quotations sent, total sales, projects) stay in the customizable "Show more" row driven by the existing KPI layout machinery (`dashboard_kpi_layouts`, surface `showroom_suite`); the three figures already in the headline row are not repeated there.

Not supported, deliberately not drawn: Showroom rating, membership/package, Shared Purchase Requests (طلبات الشراء). Direct RFQs are never labelled as purchase requests.

Sections: Needs your attention (existing component; overdue follow-ups, quotations awaiting decision, join requests), Discover new products (`catalog_products` through `loadCatalogBatch`, signed image URLs), Latest incoming quotations, Purchasing by category, Active Direct RFQs, Quick actions, What you can do here. A section is omitted entirely when the caller lacks the capability for its destination, and shows a truthful empty state when it has none.
