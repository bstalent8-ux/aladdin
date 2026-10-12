/**
 * Contractor and Engineer are TWO of the nine public accounts. Each may be operated two ways:
 *
 *   Contractor  ->  Independent Contractor      | Contractor Organization / Company
 *   Engineer    ->  Independent Engineer        | Engineering Office
 *
 * These are OPERATING MODELS, not accounts. The internal organization types behind the
 * organization models (`contractor_company`, `design_office`) are never offered as separate
 * public accounts, and choosing an organization never discards the individual identity: the
 * person keeps one login and may later apply for an organization, which still needs Admin approval.
 *
 * Pure module so the mapping is unit-testable and shared by every surface that offers the choice.
 */
export const OPERATING_MODEL_PERSONAS = ["contractor", "engineer"] as const;
export type OperatingModelPersona = (typeof OPERATING_MODEL_PERSONAS)[number];
export type OperatingModel = "independent" | "organization";

export function hasOperatingModels(persona: string | null | undefined): persona is OperatingModelPersona {
  return !!persona && (OPERATING_MODEL_PERSONAS as readonly string[]).includes(persona);
}

/** The organization type an applicant for the organization model applies for. */
export function organizationTypeFor(persona: OperatingModelPersona): "contractor_company" | "design_office" {
  return persona === "contractor" ? "contractor_company" : "design_office";
}

/**
 * The org types a person of this persona may start an organization application for.
 * A Contractor applies only for a contractor organization (the database enforces the same
 * for a new draft); every other persona keeps the existing approved set.
 */
export function applicationTypesFor<T extends string>(
  persona: string | null | undefined,
  approved: readonly T[],
): readonly (T | "contractor_company")[] {
  return persona === "contractor" ? ["contractor_company"] : approved;
}
