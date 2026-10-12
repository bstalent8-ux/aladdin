import { describe, expect, it } from "vitest";
import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";
import { CITIES_BY_GOVERNORATE as PERSONA_CITIES, GOVERNORATES as PERSONA_GOVERNORATES } from "@/lib/onboarding/persona-fields";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";
import {
  LEGACY_BUSINESS_CITIES,
  businessCitiesOf,
  readStoredLocation,
  resolveCityKey,
  resolveGovernorateKey,
  validateBusinessLocation,
} from "./business-location";

describe("the canonical Egypt catalogue (Business flow)", () => {
  it("has exactly the 27 governorates, each with a key, Arabic and English label", () => {
    expect(GOVERNORATE_OPTIONS).toHaveLength(27);
    expect(new Set(GOVERNORATE_OPTIONS.map((g) => g.value)).size).toBe(27);
    for (const g of GOVERNORATE_OPTIONS) {
      expect(g.ar.trim(), g.value).not.toBe("");
      expect(g.en.trim(), g.value).not.toBe("");
      expect(g.value, g.value).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it("offers a materially complete city list inside EVERY governorate, with bilingual labels and stable kebab-case keys", () => {
    let total = 0;
    for (const g of GOVERNORATE_OPTIONS) {
      const cities = businessCitiesOf(g.value);
      expect(cities.length, `${g.value} cities`).toBeGreaterThanOrEqual(5);
      total += cities.length;
      const keys = new Set<string>();
      for (const c of cities) {
        expect(c.value, `${g.value}/${c.value}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(c.ar.trim(), c.value).not.toBe("");
        expect(c.en.trim(), c.value).not.toBe("");
        expect(keys.has(c.value), `duplicate key ${g.value}/${c.value}`).toBe(false);
        keys.add(c.value);
      }
    }
    expect(total).toBeGreaterThanOrEqual(300);
  });

  it("never offers 'other' as a Business city (Other is a UI control)", () => {
    for (const g of GOVERNORATE_OPTIONS) expect(businessCitiesOf(g.value).some((c) => c.value === "other")).toBe(false);
  });

  it("keeps the installer catalogue's historical 'other' entry (job forms still use it)", () => {
    for (const g of GOVERNORATE_OPTIONS) expect(CITIES_BY_GOVERNORATE[g.value]!.some((c) => c.value === "other")).toBe(true);
  });

  it("keeps the historical keys", () => {
    expect(resolveCityKey("cairo", "new-cairo")).toBe("new-cairo");
    expect(resolveCityKey("dakahlia", "mansoura")).toBe("mansoura");
    expect(resolveCityKey("giza", "sheikh-zayed")).toBe("sheikh-zayed");
    expect(resolveCityKey("red-sea", "hurghada")).toBe("hurghada");
  });

  it("covers the new-urban communities the census lists as their own unit", () => {
    expect(resolveCityKey("sharqia", "العاشر من رمضان")).toBe("tenth-ramadan");
    expect(resolveCityKey("giza", "السادس من أكتوبر")).toBe("october-6");
    expect(resolveCityKey("alexandria", "مدينة برج العرب الجديدة")).toBeTruthy();
    expect(resolveCityKey("aswan", "مدينة أسوان الجديدة")).toBeTruthy();
  });
});

describe("validateBusinessLocation", () => {
  const ok = (input: Parameters<typeof validateBusinessLocation>[0], complete = true) => {
    const r = validateBusinessLocation(input, { complete });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return r.ok ? r.value : null;
  };
  const bad = (input: Parameters<typeof validateBusinessLocation>[0], code: string, complete = true) =>
    expect(validateBusinessLocation(input, { complete })).toEqual({ ok: false, code });

  it("leaves an unset location unset (location stays optional)", () => {
    expect(ok({})).toEqual({ governorate: null, city: null, cityCustomName: null });
    expect(ok({ governorate: "", city: "", cityCustomName: "  " })).toEqual({ governorate: null, city: null, cityCustomName: null });
  });

  it("accepts a canonical governorate and a city that belongs to it", () => {
    expect(ok({ governorate: "dakahlia", city: "mansoura" })).toEqual({ governorate: "dakahlia", city: "mansoura", cityCustomName: null });
  });

  it("rejects a city of another governorate (Cairo + Mansoura)", () => {
    bad({ governorate: "cairo", city: "mansoura" }, "locationInvalid");
  });

  it("rejects an unknown governorate and a city without a governorate", () => {
    bad({ governorate: "narnia" }, "locationInvalid");
    bad({ city: "maadi" }, "locationInvalid");
    bad({ cityCustomName: "Somewhere" }, "locationInvalid");
  });

  it("a chosen governorate needs a city to COMPLETE, but may be saved alone as a draft", () => {
    bad({ governorate: "cairo" }, "cityRequired");
    expect(ok({ governorate: "cairo" }, false)).toEqual({ governorate: "cairo", city: null, cityCustomName: null });
  });

  it("stores a custom city exactly as entered (trimmed, spaces collapsed), never as 'other'", () => {
    expect(ok({ governorate: "dakahlia", cityCustomName: "  Kafr   Test Village " })).toEqual({
      governorate: "dakahlia",
      city: null,
      cityCustomName: "Kafr Test Village",
    });
  });

  it("rejects the literal 'other' (and its Arabic spellings) as a city or a custom city", () => {
    for (const lit of ["other", "Other", "OTHER", "أخرى", "اخرى", "مدينة أخرى", "Other city"]) {
      bad({ governorate: "cairo", city: lit }, "locationInvalid");
      bad({ governorate: "cairo", cityCustomName: lit }, "locationInvalid");
    }
  });

  it("rejects a blank, too-short, too-long, or doubled custom city", () => {
    bad({ governorate: "cairo", cityCustomName: "   " }, "cityRequired");
    bad({ governorate: "cairo", cityCustomName: "A" }, "locationInvalid");
    bad({ governorate: "cairo", cityCustomName: "x".repeat(81) }, "locationInvalid");
    bad({ governorate: "cairo", city: "maadi", cityCustomName: "Somewhere" }, "locationInvalid");
  });

  it("stores a typed name that IS a catalogue city of the governorate as that city", () => {
    expect(ok({ governorate: "cairo", cityCustomName: "Maadi" })).toEqual({ governorate: "cairo", city: "maadi", cityCustomName: null });
  });

  it("resolves historical underscore keys (nasr_city -> nasr-city, new_cairo, sheikh_zayed, october_6)", () => {
    expect(ok({ governorate: "cairo", city: "nasr_city" })!.city).toBe("nasr-city");
    expect(ok({ governorate: "cairo", city: "new_cairo" })!.city).toBe("new-cairo");
    expect(ok({ governorate: "giza", city: "sheikh_zayed" })!.city).toBe("sheikh-zayed");
    expect(ok({ governorate: "giza", city: "october_6" })!.city).toBe("october-6");
  });

  it("accepts a governorate by Arabic or English name too", () => {
    expect(resolveGovernorateKey("القاهرة")).toBe("cairo");
    expect(resolveGovernorateKey("Red Sea")).toBe("red-sea");
    expect(resolveGovernorateKey("")).toBeNull();
  });
});

describe("readStoredLocation (resume)", () => {
  it("returns a canonical stored location unchanged", () => {
    expect(readStoredLocation("cairo", "maadi", null)).toEqual({ governorate: "cairo", city: "maadi", cityCustomName: null });
  });

  it("keeps a stored custom city (the Other state) and no canonical city", () => {
    expect(readStoredLocation("dakahlia", null, "Kafr Test")).toEqual({ governorate: "dakahlia", city: null, cityCustomName: "Kafr Test" });
  });

  it("resolves historical underscore keys so an old draft resumes", () => {
    expect(readStoredLocation("cairo", "nasr_city", null)).toEqual({ governorate: "cairo", city: "nasr-city", cityCustomName: null });
    expect(readStoredLocation("giza", "october_6", null).city).toBe("october-6");
  });

  it("a stored value the catalogue does not know is KEPT as the typed city, never emptied", () => {
    expect(readStoredLocation("cairo", "some typed place", null)).toEqual({ governorate: "cairo", city: null, cityCustomName: "some typed place" });
    expect(readStoredLocation("narnia", "x", null)).toEqual({ governorate: null, city: null, cityCustomName: null });
    expect(readStoredLocation(null, null, null)).toEqual({ governorate: null, city: null, cityCustomName: null });
  });

  it("never resumes the literal 'other' as a custom city", () => {
    expect(readStoredLocation("cairo", null, "Other").cityCustomName).toBeNull();
  });
});

describe("EVERY historical (persona-vocabulary) Business city value has an explicit outcome", () => {
  const legacy = PERSONA_GOVERNORATES.flatMap((gov) => PERSONA_CITIES[gov].map((value) => ({ gov, value })));

  it("covers all 15 values the old wizard offered, and nothing else", () => {
    expect(legacy).toHaveLength(15);
    expect(new Set(legacy.map((l) => `${l.gov}/${l.value}`))).toEqual(new Set(Object.keys(LEGACY_BUSINESS_CITIES)));
  });

  it.each(legacy.map((l) => [l.gov, l.value] as const))("%s / %s: resumes non-empty, saves, and keeps its meaning", (gov, value) => {
    const outcome = LEGACY_BUSINESS_CITIES[`${gov}/${value}`]!;
    for (const locale of ["en", "ar"] as const) {
      const read = readStoredLocation(gov, value, null, locale);
      expect(read.governorate).toBe(gov);
      // never silently empty
      expect(read.city !== null || read.cityCustomName !== null, `${gov}/${value} (${locale}) became empty`).toBe(true);
      if ("city" in outcome) {
        // A. maps cleanly to a catalogue city of the SAME governorate
        expect(read).toEqual({ governorate: gov, city: outcome.city, cityCustomName: null });
        expect(businessCitiesOf(gov).some((c) => c.value === outcome.city), `${gov}/${outcome.city} is not a catalogue city`).toBe(true);
      } else {
        // B. a valid place the catalogue does not list here: the person's own typed city, in the wording they saw
        const label = locale === "ar" ? ar.onboarding.consumer.cities[value as keyof typeof ar.onboarding.consumer.cities] : en.onboarding.consumer.cities[value as keyof typeof en.onboarding.consumer.cities];
        expect(read).toEqual({ governorate: gov, city: null, cityCustomName: label });
        expect(outcome.custom[locale]).toBe(label);
      }
      // ...and the resumed value validates, so SAVING the resumed draft needs no re-entry
      const saved = validateBusinessLocation({ governorate: read.governorate, city: read.city, cityCustomName: read.cityCustomName }, { complete: true });
      expect(saved.ok, `${gov}/${value} (${locale}) cannot be saved after resume`).toBe(true);
    }
    // A raw legacy value posted straight to validation is converted the same way (no client involved).
    const direct = validateBusinessLocation({ governorate: gov, city: value }, { complete: true });
    expect(direct.ok, `${gov}/${value} rejected when posted raw`).toBe(true);
    if (direct.ok) expect(direct.value.city !== null || direct.value.cityCustomName !== null).toBe(true);
  });

  it("Sidi Gaber is the catalogue's Sidi Jabir; Smouha and Miami are preserved as typed cities; Shibin El Kom is NOT mapped onto a Qalyubia city", () => {
    expect(readStoredLocation("alexandria", "sidi_gaber", null).city).toBe("sidi-jabir");
    expect(readStoredLocation("alexandria", "smouha", null, "en").cityCustomName).toBe("Smouha");
    expect(readStoredLocation("alexandria", "miami", null, "ar").cityCustomName).toBe("ميامي");
    const shibin = readStoredLocation("qalyubia", "shibin", null, "en");
    expect(shibin).toEqual({ governorate: "qalyubia", city: null, cityCustomName: "Shibin El Kom" });
  });
});
