import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS, type LocationOption } from "@/lib/installer/location-data";
import { normalizePlace } from "@/lib/installer/opportunity-location";

/**
 * The BUSINESS location rule, on the one canonical Egypt catalogue (`lib/installer/location-data.ts`, mirrored in SQL by
 * `app.place_governorates` / `app.place_cities`). It is a faithful TypeScript mirror of `app.normalize_business_location`
 * (migration 20261011090002): the UI and the server action use it for early, friendly rejection; the database stays the
 * final authority.
 *
 *   governorate        a catalogue governorate key (27 of them)
 *   city               a catalogue city key INSIDE that governorate, or null
 *   cityCustomName     the city typed through "Other", or null — mutually exclusive with `city`
 *
 * "Other" is a UI control, never a stored value: the literal key `other` and the words "Other" / "أخرى" are rejected as a
 * city. Historical (persona-vocabulary) underscore keys such as `nasr_city` resolve to their kebab-case catalogue keys.
 */
export const CUSTOM_CITY_MIN = 2;
export const CUSTOM_CITY_MAX = 80;

const OTHER_LITERALS = new Set(
  ["other", "other city", "أخرى", "اخرى", "اخري", "مدينة أخرى", "مدينة اخرى"].map((v) => normalizePlace(v)),
);

/**
 * EVERY city value the OLD Business wizard (the 4-governorate "persona" vocabulary, `lib/onboarding/persona-fields.ts`) could
 * have stored in a draft, with its explicit compatibility outcome. A stored location is NEVER silently emptied:
 *   A. it maps cleanly to a catalogue city of the same governorate  -> that city key;
 *   B. it is a valid place the catalogue does not list (or lists in another governorate) -> kept as the person's own typed
 *      city, in the wording they saw (English / Arabic label).
 * The SQL twin is `app.legacy_business_city` (migration 20261011090002); a table-driven test pins every row.
 */
export type LegacyCityOutcome = { city: string } | { custom: { en: string; ar: string } };
export const LEGACY_BUSINESS_CITIES: Record<string, LegacyCityOutcome> = {
  // cairo
  "cairo/nasr_city": { city: "nasr-city" },
  "cairo/new_cairo": { city: "new-cairo" },
  "cairo/maadi": { city: "maadi" },
  "cairo/heliopolis": { city: "heliopolis" },
  "cairo/downtown": { city: "downtown" },
  // giza
  "giza/sheikh_zayed": { city: "sheikh-zayed" },
  "giza/dokki": { city: "dokki" },
  "giza/mohandessin": { city: "mohandessin" },
  "giza/october_6": { city: "october-6" },
  // alexandria: Sidi Gaber is the catalogue's Sidi Jabir; Smouha and Miami are neighbourhoods the catalogue does not list.
  "alexandria/smouha": { custom: { en: "Smouha", ar: "سموحة" } },
  "alexandria/miami": { custom: { en: "Miami", ar: "ميامي" } },
  "alexandria/sidi_gaber": { city: "sidi-jabir" },
  // qalyubia: banha and qalyub are catalogue cities. The old list's "shibin" is labelled "Shibin El Kom", which is a city of
  // MONUFIA, not Qalyubia, so it is preserved as the person's typed city rather than mapped onto Shibin El Qanater.
  "qalyubia/shibin": { custom: { en: "Shibin El Kom", ar: "شبين الكوم" } },
  "qalyubia/banha": { city: "banha" },
  "qalyubia/qalyub": { city: "qalyub" },
};

export type BusinessLocation = {
  governorate: string | null;
  city: string | null;
  cityCustomName: string | null;
};

export type LocationFailure = "locationInvalid" | "cityRequired";
export type LocationCheck = { ok: true; value: BusinessLocation } | { ok: false; code: LocationFailure };

export const EMPTY_LOCATION: BusinessLocation = { governorate: null, city: null, cityCustomName: null };

/** Historical drafts used underscore keys (`nasr_city`); the catalogue uses kebab-case. */
export function legacyKey(value: string): string {
  return value.trim().replace(/_/g, "-");
}

function matches(option: LocationOption, text: string): boolean {
  const n = normalizePlace(text);
  return [option.value, option.ar, option.en].some((name) => normalizePlace(name) === n);
}

export function resolveGovernorateKey(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return GOVERNORATE_OPTIONS.find((g) => matches(g, legacyKey(value)))?.value ?? null;
}

/** The selectable cities of a governorate: the catalogue list WITHOUT its "other" entry (Other is a UI control). */
export function businessCitiesOf(governorate: string | null | undefined): LocationOption[] {
  if (!governorate) return [];
  return (CITIES_BY_GOVERNORATE[governorate] ?? []).filter((c) => c.value !== "other");
}

export function resolveCityKey(governorate: string, value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return businessCitiesOf(governorate).find((c) => matches(c, legacyKey(value)))?.value ?? null;
}

function isOtherLiteral(value: string): boolean {
  return OTHER_LITERALS.has(normalizePlace(value));
}

/**
 * Validate what the user chose. `complete: false` is a draft being edited (a governorate alone is fine);
 * `complete: true` is a submission (a chosen governorate needs a city). An unset location is always allowed.
 */
export function validateBusinessLocation(
  input: { governorate?: string | null; city?: string | null; cityCustomName?: string | null },
  { complete }: { complete: boolean },
): LocationCheck {
  const govText = input.governorate?.trim() || null;
  const cityText = input.city?.trim() || null;
  const custom = input.cityCustomName?.replace(/\s+/g, " ").trim() || null;

  if (!govText) {
    return cityText || custom ? { ok: false, code: "locationInvalid" } : { ok: true, value: EMPTY_LOCATION };
  }
  const governorate = resolveGovernorateKey(govText);
  if (!governorate) return { ok: false, code: "locationInvalid" };
  if (cityText && custom) return { ok: false, code: "locationInvalid" };

  let city: string | null = null;
  let cityCustomName: string | null = null;
  if (cityText) {
    if (isOtherLiteral(cityText)) return { ok: false, code: "locationInvalid" };
    const legacy = LEGACY_BUSINESS_CITIES[`${governorate}/${cityText}`];
    if (legacy && "custom" in legacy) {
      cityCustomName = legacy.custom.en;
    } else {
      city = legacy ? legacy.city : resolveCityKey(governorate, cityText);
      // Not in THIS governorate's catalogue (including a city of another governorate).
      if (!city) return { ok: false, code: "locationInvalid" };
    }
  } else if (custom) {
    if (custom.length < CUSTOM_CITY_MIN || custom.length > CUSTOM_CITY_MAX || isOtherLiteral(custom)) {
      return { ok: false, code: "locationInvalid" };
    }
    // A name that IS a catalogue city of this governorate is stored as that city.
    city = businessCitiesOf(governorate).find((c) => matches(c, custom))?.value ?? null;
    if (!city) cityCustomName = custom;
  }
  if (complete && !city && !cityCustomName) return { ok: false, code: "cityRequired" };
  return { ok: true, value: { governorate, city, cityCustomName } };
}

/**
 * Read a STORED location back into canonical form for the wizard. Never throws and NEVER turns a non-empty stored city into
 * an empty one: a legacy persona-vocabulary key resolves through `LEGACY_BUSINESS_CITIES` (a catalogue city, or the person's
 * own typed city in their language), a catalogue key or name resolves normally, and any other stored text is kept as the
 * typed city. Only a governorate that is not a catalogue governorate (not producible by the old wizard) reads as unset.
 */
export function readStoredLocation(
  governorate: string | null | undefined,
  city: string | null | undefined,
  cityCustomName: string | null | undefined,
  locale: "en" | "ar" = "en",
): BusinessLocation {
  const gov = resolveGovernorateKey(governorate);
  if (!gov) return EMPTY_LOCATION;
  const custom = cityCustomName?.replace(/\s+/g, " ").trim() || null;
  if (custom && !isOtherLiteral(custom)) return { governorate: gov, city: null, cityCustomName: custom };
  const text = city?.trim() || null;
  if (!text || isOtherLiteral(text)) return { governorate: gov, city: null, cityCustomName: null };
  const legacy = LEGACY_BUSINESS_CITIES[`${gov}/${text}`];
  if (legacy) {
    return "custom" in legacy
      ? { governorate: gov, city: null, cityCustomName: legacy.custom[locale] }
      : { governorate: gov, city: legacy.city, cityCustomName: null };
  }
  const resolved = resolveCityKey(gov, text);
  if (resolved) return { governorate: gov, city: resolved, cityCustomName: null };
  return { governorate: gov, city: null, cityCustomName: text.slice(0, CUSTOM_CITY_MAX) };
}
