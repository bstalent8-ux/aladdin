/**
 * THE canonical account taxonomy: the nine public account types, their business
 * subtypes and the database identifiers behind them. Registration, onboarding,
 * profiles, Admin, directory filters, product audiences, Purchase Request
 * visibility and the tests all read this one definition; the database enforces
 * the same relationships (`persona_type`, `organization_type`, `public.activities`
 * with the `*_type_guard` triggers, `public.trades`, `public.product_audience_types`).
 *
 * Internal identifiers are NOT accounts:
 *   - `contractor_company` is the business workspace behind the Contractor account
 *     and `design_office` the business workspace behind the Engineer account. Neither
 *     is offered at registration and neither adds a tenth account.
 *   - Sales staff roles (`sales_rep`, `sales_manager`) are internal roles, not
 *     business subtypes, and Sales Team is NOT a target audience: it inherits the
 *     audience of the workspace the person is acting in.
 *   - Craftsman specialties (`public.trades`, 14 active) are a separate MULTI-SELECT
 *     taxonomy, never account types or subtypes.
 * Retired values (`interior_designer`, `wholesaler` as an account, `trainer`,
 * `trainee`) no longer exist in the database and must not be reintroduced here.
 */
import type { Database } from "@/types/database.types";

type PersonaType = Database["public"]["Enums"]["persona_type"];
type OrgType = Database["public"]["Enums"]["organization_type"];

export const PUBLIC_ACCOUNT_IDS = [
  "showroom",
  "supplier",
  "manufacturer",
  "importer",
  "contractor",
  "engineer",
  "craftsman",
  "sales_team",
  "personal",
] as const;
export type PublicAccountId = (typeof PUBLIC_ACCOUNT_IDS)[number];

/** The eight product / Purchase Request audiences (`public.product_audience_types`). Sales Team is not one. */
export const PRODUCT_AUDIENCE_CODES = [
  "showroom_dealer",
  "supplier",
  "manufacturer",
  "importer",
  "contractor",
  "engineer",
  "installer_technician",
  "end_consumer",
] as const;
export type ProductAudienceCode = (typeof PRODUCT_AUDIENCE_CODES)[number];

export type PublicAccount = {
  id: PublicAccountId;
  /** Registration choice key (the value stored in the account-type form field). */
  choiceKey: string;
  /** A business account is an organization type; the rest are personal personas. */
  kind: "business" | "personal";
  persona: PersonaType | null;
  /** The organization type behind the account (public for the four businesses, internal for Contractor / Engineer). */
  orgType: OrgType | null;
  /** The account's product / request audience; null for Sales Team (inherits the workspace's). */
  audience: ProductAudienceCode | null;
  /** The ONLY business subtypes (`public.activities`) valid for this account. */
  subtypes: readonly string[];
  /** Internal staff roles that are not business subtypes. */
  staffRoles: readonly string[];
};

export const PUBLIC_ACCOUNTS: readonly PublicAccount[] = [
  {
    id: "showroom",
    choiceKey: "showroom_dealer",
    kind: "business",
    persona: null,
    orgType: "showroom_dealer",
    audience: "showroom_dealer",
    subtypes: ["decor_showroom", "paint_showroom", "decor_and_paint_showroom", "building_and_finishing_supplies_retailer"],
    staffRoles: [],
  },
  {
    id: "supplier",
    choiceKey: "supplier",
    kind: "business",
    persona: null,
    orgType: "supplier",
    audience: "supplier",
    // Wholesaler is a Supplier subtype, never an independent account.
    subtypes: ["distributor", "wholesaler"],
    staffRoles: [],
  },
  {
    id: "manufacturer",
    choiceKey: "manufacturer",
    kind: "business",
    persona: null,
    orgType: "manufacturer",
    audience: "manufacturer",
    subtypes: ["paint_manufacturer", "decor_manufacturer"],
    staffRoles: [],
  },
  {
    id: "importer",
    choiceKey: "importer",
    kind: "business",
    persona: null,
    orgType: "importer",
    audience: "importer",
    subtypes: ["decor_supplies_importer", "paint_importer"],
    staffRoles: [],
  },
  {
    id: "contractor",
    choiceKey: "contractor",
    kind: "personal",
    persona: "contractor",
    orgType: "contractor_company",
    audience: "contractor",
    subtypes: [],
    staffRoles: [],
  },
  {
    id: "engineer",
    choiceKey: "engineer",
    kind: "personal",
    persona: "engineer",
    orgType: "design_office",
    audience: "engineer",
    subtypes: ["finishing"],
    staffRoles: [],
  },
  {
    id: "craftsman",
    choiceKey: "installer_technician",
    kind: "personal",
    persona: "installer_technician",
    orgType: null,
    audience: "installer_technician",
    subtypes: [],
    staffRoles: [],
  },
  {
    id: "sales_team",
    choiceKey: "salesperson",
    kind: "personal",
    persona: "sales",
    orgType: null,
    audience: null,
    subtypes: [],
    staffRoles: ["sales_rep", "sales_manager"],
  },
  {
    id: "personal",
    choiceKey: "end_consumer",
    kind: "personal",
    persona: "end_consumer",
    orgType: null,
    audience: "end_consumer",
    subtypes: [],
    staffRoles: [],
  },
];

export const ACCOUNT_BY_ID: Readonly<Record<PublicAccountId, PublicAccount>> = Object.fromEntries(
  PUBLIC_ACCOUNTS.map((a) => [a.id, a]),
) as Record<PublicAccountId, PublicAccount>;

/** The registration order of the nine accounts. */
export const REGISTRATION_ORDER: readonly string[] = PUBLIC_ACCOUNTS.map((a) => a.choiceKey);

/** The organization types a NEW business may register as (the four public businesses + the Engineer business). */
export const REGISTERABLE_BUSINESS_ORG_TYPES = ["showroom_dealer", "supplier", "manufacturer", "importer", "design_office"] as const satisfies readonly OrgType[];

export function accountForOrgType(orgType: string | null | undefined): PublicAccount | null {
  return PUBLIC_ACCOUNTS.find((a) => a.orgType === orgType) ?? null;
}

export function accountForPersona(persona: string | null | undefined): PublicAccount | null {
  return PUBLIC_ACCOUNTS.find((a) => a.persona === persona) ?? null;
}

/** Is `subtype` a valid business subtype of this account? (The database enforces the same rule.) */
export function isSubtypeOf(account: PublicAccountId, subtype: string): boolean {
  return ACCOUNT_BY_ID[account].subtypes.includes(subtype);
}

/**
 * The audience of an acting context: a workspace (organization type) wins; only with no workspace does the
 * person's own persona apply. Sales Team never contributes an audience of its own.
 */
export function audienceFor(orgType: string | null | undefined, persona: string | null | undefined): ProductAudienceCode | null {
  if (orgType) return accountForOrgType(orgType)?.audience ?? null;
  return accountForPersona(persona)?.audience ?? null;
}
