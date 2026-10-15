import { describe, expect, it } from "vitest";
import { businessDetailsSchema, SHOWROOM_ACTIVITIES, businessAddressSchema, businessAddressWords, showroomIdentityError, validBusinessPhone } from "./business-details";
describe("showroom business details", () => {
 it("allows empty address and exactly 250 words; rejects 251", () => {expect(businessAddressSchema.safeParse("").success).toBe(true);expect(businessAddressSchema.safeParse("كلمة ".repeat(250)).success).toBe(true);expect(businessAddressSchema.safeParse("كلمة ".repeat(251)).success).toBe(false);expect(businessAddressWords(" شارع\nالمعرض\tالجديد ")).toBe(3);});
 it.each(["+201012345678", "+14155552671", "+442079460018"])("validates country metadata for %s", phone => expect(validBusinessPhone(phone)).toBe(true));
 it.each([null, "01012345678", "+201234", "+14150000000", "+201399999999", "+2001012345678", "+" + "1".repeat(100)])("rejects invalid / noncanonical phone %s", phone => expect(validBusinessPhone(phone)).toBe(false));
 it("rejects national numbering plans exceeding the E.164 transport limit", () => {
  expect(validBusinessPhone("+4912345678901234")).toBe(false);
 });
 it("requires phone and activity", () => {expect(showroomIdentityError({})).toBe("onboarding.error.showroomPhoneRequired"); expect(showroomIdentityError({contactPhone:"+201012345678"})).toBe("onboarding.error.activityRequired");});
 it.each(SHOWROOM_ACTIVITIES)("accepts existing activity %s with optional email", activityType => expect(showroomIdentityError({contactPhone:"+201012345678",activityType})).toBeNull());
 it("normalizes optional email and rejects malformed / oversized inputs", () => {expect(businessDetailsSchema.parse({contactEmail:"  LOCAL@Example.test "}).contactEmail).toBe("local@example.test");expect(businessDetailsSchema.parse({contactEmail:" "}).contactEmail).toBeNull();expect(businessDetailsSchema.safeParse({contactEmail:"broken"}).success).toBe(false);expect(businessDetailsSchema.safeParse({detailedAddress:"كلمة ".repeat(251)}).success).toBe(false);});
});
