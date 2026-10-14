import { z } from "zod";
import { toCanonicalPhone } from "@/lib/contact/phone";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
export const SHOWROOM_ACTIVITIES = ["decor_showroom", "paint_showroom", "decor_and_paint_showroom", "building_and_finishing_supplies_retailer"] as const;
export const BUSINESS_ADDRESS_MAX_WORDS = 250;
export function businessAddressWords(value: string): number { return value.trim().split(/\s+/u).filter(Boolean).length; }
export const businessAddressSchema = z.string().trim().max(16384).refine(value => businessAddressWords(value) <= BUSINESS_ADDRESS_MAX_WORDS, "addressTooLong");
export const businessDetailsSchema = z.object({
  contactPhone: z.string().max(32).nullish(),
  contactEmail: z.string().trim().max(254).nullish().transform(v => v ? v.toLowerCase() : null).refine(v => !v || z.string().email().safeParse(v).success, "emailInvalid"),
  activityType: z.enum(SHOWROOM_ACTIVITIES).nullish(),
  detailedAddress: businessAddressSchema.nullish(),
});
export function validBusinessPhone(value: string | null | undefined): boolean {
  if (!value || value.length > 32) return false;
  const phone = parsePhoneNumberFromString(value);
  return !!phone?.country && toCanonicalPhone(value, phone.country)?.e164 === value;
}
export function showroomIdentityError(input: z.input<typeof businessDetailsSchema>): string | null {
  const parsed = businessDetailsSchema.safeParse(input);
  if (!parsed.success) return "onboarding.error.contactInvalid";
  if (!validBusinessPhone(input.contactPhone)) return "onboarding.error.showroomPhoneRequired";
  if (!input.activityType) return "onboarding.error.activityRequired";
  return null;
}

export type SHOWROOM_ACTIVITIES_TYPE = typeof SHOWROOM_ACTIVITIES[number] | null;
