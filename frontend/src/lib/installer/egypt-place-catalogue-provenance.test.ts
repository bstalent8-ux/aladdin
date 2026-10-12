import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "./location-data";

/**
 * PROVENANCE OF THE EXPANDED EGYPT CATALOGUE.
 *
 * `docs/database/egypt-place-catalogue-provenance.json` records, for EVERY place added by migration
 * 20261011090001, the governorate, machine key, Arabic and English name, administrative type and where it came from (the
 * official CAPMAS Administrative Units Guide, January 2023). This test keeps the audit file, the TypeScript catalogue and the
 * SQL expansion in step, so an entry can never be added without a recorded source, and an unverified one can never slip in.
 */
const ROOT = path.resolve(__dirname, "../../../..");
const audit = JSON.parse(readFileSync(path.join(ROOT, "docs/database/egypt-place-catalogue-provenance.json"), "utf8")) as {
  source: string;
  source_url: string;
  counts: Record<string, number>;
  excluded_units: unknown[];
  aliases: { governorate: string; official_name: string; target_key: string }[];
  added: {
    governorate: string;
    key: string;
    ar: string;
    en: string | null;
    en_label_shown: string;
    en_source: string;
    administrative_types: string[];
    official_names: string[];
    source: string;
    source_pdf_page: number;
    status: string;
  }[];
  existing: { governorate: string; key: string; source: string | null; status: string }[];
  removed_from_secondary_list: { governorate: string; key: string; status: string }[];
};

const ORIGINAL_SQL = readFileSync(path.join(ROOT, "supabase/migrations/20261006090003_place_catalogue.sql"), "utf8");
const EXPANSION_SQL = readFileSync(path.join(ROOT, "supabase/migrations/20261011090001_expand_egypt_place_catalogue.sql"), "utf8");
const rows = (sql: string) => [...sql.matchAll(/\('([a-z-]+)', '([^']+)', '((?:[^']|'')*)'\)/g)].map((m) => ({ gov: m[1]!, key: m[2]!, name: m[3]!.replace(/''/g, "'") }));

const govKeys = new Set(GOVERNORATE_OPTIONS.map((g) => g.value));
const originalKeys = new Set(
  rows(ORIGINAL_SQL.slice(ORIGINAL_SQL.indexOf("insert into app.place_cities")))
    .filter((r) => r.key !== "other")
    .map((r) => `${r.gov}/${r.key}`),
);
const tsKeys = new Set(Object.entries(CITIES_BY_GOVERNORATE).flatMap(([gov, cities]) => cities.filter((c) => c.value !== "other").map((c) => `${gov}/${c.value}`)));
const expansionKeys = new Set(rows(EXPANSION_SQL.slice(EXPANSION_SQL.indexOf("insert into app.place_cities"))).map((r) => `${r.gov}/${r.key}`));
const TYPES = new Set(["city", "markaz", "kism", "new urban community"]);

describe("catalogue provenance (official CAPMAS 2023)", () => {
  it("names its official source", () => {
    expect(audit.source).toMatch(/CAPMAS/);
    expect(audit.source).toMatch(/January 2023/);
    expect(audit.source_url).toMatch(/^https:\/\/www\.capmas\.gov\.eg/);
  });

  it("records every added place with governorate, key, Arabic name, administrative type and source", () => {
    expect(audit.added.length).toBeGreaterThan(250);
    for (const a of audit.added) {
      const id = `${a.governorate}/${a.key}`;
      expect(govKeys.has(a.governorate), id).toBe(true);
      expect(a.key, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(a.ar.trim(), id).not.toBe("");
      expect(a.administrative_types.length, id).toBeGreaterThan(0);
      for (const t of a.administrative_types) expect(TYPES.has(t), `${id} type ${t}`).toBe(true);
      expect(a.official_names.length, id).toBeGreaterThan(0);
      expect(a.source, id).toMatch(/CAPMAS/);
      expect(a.source_pdf_page, id).toBeGreaterThan(10);
      expect(a.status, id).toBe("verified in the official directory");
    }
  });

  it("the audit's added keys are EXACTLY the keys the expansion migration adds and the TypeScript catalogue gained", () => {
    const added = new Set(audit.added.map((a) => `${a.governorate}/${a.key}`));
    expect(added.size).toBe(audit.added.length); // no duplicate
    expect(added).toEqual(expansionKeys);
    const gained = new Set([...tsKeys].filter((k) => !originalKeys.has(k)));
    expect(gained).toEqual(added);
  });

  it("every added place's labels in the catalogue match the audit", () => {
    for (const a of audit.added) {
      const city = CITIES_BY_GOVERNORATE[a.governorate]!.find((c) => c.value === a.key)!;
      expect(city.ar, a.key).toBe(a.ar);
      expect(city.en, a.key).toBe(a.en_label_shown);
    }
  });

  it("never invents an English name: a place without a sourced English label shows its Arabic name and an opaque stable key", () => {
    const pending = audit.added.filter((a) => a.en === null);
    expect(pending.length).toBe(audit.counts.added_with_provisional_arabic_english_label);
    for (const a of pending) {
      expect(a.en_label_shown, a.key).toBe(a.ar);
      expect(a.key, a.key).toMatch(/^place-[0-9a-f]{8}$/);
      expect(a.en_source, a.key).toMatch(/^none/);
    }
    for (const a of audit.added.filter((x) => x.en !== null)) expect(a.en_source, a.key).toMatch(/transliteration/);
  });

  it("lists the unverified / removed entries explicitly instead of presenting them as verified", () => {
    const notInDirectory = audit.existing.filter((e) => e.source === null);
    expect(notInDirectory.map((e) => `${e.governorate}/${e.key}`).sort()).toEqual(
      ["cairo/downtown", "giza/mohandessin", "ismailia/el-qantara", "suez/ain-sokhna"].sort(),
    );
    for (const e of notInDirectory) expect(tsKeys.has(`${e.governorate}/${e.key}`), e.key).toBe(true); // kept for compatibility
    expect(audit.removed_from_secondary_list.map((r) => `${r.governorate}/${r.key}`).sort()).toEqual(["cairo/az-zamalik", "cairo/turah"]);
    for (const r of audit.removed_from_secondary_list) expect(tsKeys.has(`${r.governorate}/${r.key}`), r.key).toBe(false);
  });

  it("the recorded counts match the catalogue", () => {
    expect(audit.counts.governorates).toBe(27);
    expect(audit.counts.added_cities).toBe(audit.added.length);
    expect(audit.counts.existing_catalogue_cities).toBe(originalKeys.size);
    expect(audit.counts.final_cities_without_other).toBe(tsKeys.size);
    expect(tsKeys.size).toBe(originalKeys.size + audit.added.length);
  });

  it("documents the excluded unit kinds and every alias it relied on", () => {
    expect(audit.excluded_units.length).toBeGreaterThan(0);
    expect(audit.aliases.length).toBe(14);
    for (const a of audit.aliases) expect(tsKeys.has(`${a.governorate}/${a.target_key}`), a.target_key).toBe(true);
  });

  it("every existing catalogue key is still present (historical keys preserved)", () => {
    for (const k of originalKeys) expect(tsKeys.has(k), k).toBe(true);
  });
});
