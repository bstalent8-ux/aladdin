# Egypt place catalogue and business location

The one canonical list of Egyptian places is `frontend/src/lib/installer/location-data.ts`. It is mirrored in SQL by
`app.place_governorates` and `app.place_cities`, and `frontend/src/lib/installer/location-sql-parity.test.ts` fails the moment
the two disagree. The installer Jobs board, service areas, the Overall Match and the **Business** flow all read it.
`docs/database/egypt-place-catalogue-provenance.json` records the source of every place added in the 2026-10-11 expansion, and
`frontend/src/lib/installer/egypt-place-catalogue-provenance.test.ts` keeps that file, the TypeScript catalogue and the SQL in step.

| | governorates | cities (without `other`) | `app.place_cities` rows |
|---|---|---|---|
| before 2026-10-11 | 27 | 86 | 339 |
| after | 27 | 379 | 1152 |

## Authority: the official CAPMAS directory

Migration `20261011090001_expand_egypt_place_catalogue.sql` adds **293** places. Every one is a unit of the official
**CAPMAS "دليل الوحدات الإدارية لمحافظات الجمهورية" (Administrative Units Guide), January 2023 edition**, published at
`capmas.gov.eg` (publication "دليل الوحدات الإدارية (A.U.G)").

* **How it was read.** The PDF's text layer misdecodes some Arabic letters, so the 27 per-governorate statements ("بيان الأقسام والشياخات
  والمدن والقرى والمجتمعات العمرانية الجديدة بمحافظة …") were read from the rendered pages and transcribed. The transcription was checked
  against the directory's own national totals: **175 markaz and 231 cities match exactly**.
* **What is catalogued.** The kisms, markaz, cities and new urban communities of each governorate. Places are merged (the markaz, the city
  and the kisms of Mansoura are one entry; numbered kisms 1/2/3 collapse into their city).
* **What is not.** Villages, shiakhas, hamlets and neighbourhoods (the Business flow offers **Other** for them), port-police administrations,
  legal units, areas (`منطقة …`), extensions (`امتداد …`) and police-only kisms/markaz. The excluded units are listed in the provenance file.
* **Secondary source.** citypopulation.de (CAPMAS 2017 census units) was used only as an input to *labels*: its Latin transliteration of the same
  CAPMAS unit is the English label where one exists. It is not an authority for any place: two of its units (Zamalek, Turah) are absent from
  the 2023 directory and were **not added**.
* **English labels.** The directory is Arabic only. 227 added places carry the transliteration above; **66 have no sourced English name**.
  Those are not given an invented one: they show their Arabic name in English too (a provisional label) and have an opaque stable key
  (`place-<hash>`) that does not change when an official English name is supplied. They are marked `en: null` in the provenance file.
* **Existing entries win.** A place already in the catalogue keeps its key and labels. Fourteen spelling variants between the directory and the
  catalogue are matched by an explicit alias table (provenance file, `aliases`).
* **Existing entries that are not 2023 directory units** (kept, because jobs and stored areas may reference them): Downtown Cairo, Mohandessin,
  Ain Sokhna, El Qantara. They are listed in the provenance file with status "NOT in the official directory".

## Business location is stored on the primary branch

`organizations` has **no** location columns: one organization can have branches in several governorates and cities. The primary
branch created with the organization carries it.

| column (`public.branches`) | meaning |
|---|---|
| `governorate_key` | a catalogue governorate key |
| `city_key` | a catalogue city key **inside that governorate**, or NULL |
| `city_custom_name` | the city typed through **Other**, or NULL; never together with `city_key` |

* "Other" is a UI control. The literal `other` (and "Other" / "أخرى") is never stored in `city_key` or `city_custom_name`.
* `business_creation_drafts` uses the same three fields (`governorate`, `city`, `city_custom_name`) so a refresh, sign-out or
  resume keeps the difference between a chosen city and a typed one.
* The rule lives once in `app.normalize_business_location` (used by draft save, draft submit, `app.organization_create_owned`, referral approval
  and a trigger on `branches`), and is mirrored in `frontend/src/lib/location/business-location.ts` for early UI/server-action rejection.
* A location is optional as a whole. Once a governorate is chosen a city (or a typed city) is required to complete.

### Historical drafts never lose their location

The old Business wizard stored the 4-governorate "persona" vocabulary (underscore keys). **Every one of its 15 city values has an explicit outcome**
(`app.legacy_business_city` in SQL, `LEGACY_BUSINESS_CITIES` in TypeScript, pinned by pgTAP `88` and a table-driven unit test):

| governorate | legacy value | outcome |
|---|---|---|
| cairo | nasr_city, new_cairo, maadi, heliopolis, downtown | catalogue city (nasr-city, new-cairo, maadi, heliopolis, downtown) |
| giza | sheikh_zayed, dokki, mohandessin, october_6 | catalogue city (sheikh-zayed, dokki, mohandessin, october-6) |
| alexandria | sidi_gaber | catalogue city **sidi-jabir** (the same place) |
| alexandria | smouha, miami | kept as the person's typed city ("Smouha", "Miami"; Arabic wording when they use Arabic) |
| qalyubia | banha, qalyub | catalogue city (banha, qalyub) |
| qalyubia | shibin | kept as typed text **"Shibin El Kom"**: the old list put this Monufia city under Qalyubia, so it is not mapped onto a Qalyubia city |

A non-empty stored location never becomes empty: any other stored text under a valid governorate resumes as the person's typed city.

## Legal name

`organizations.legal_name` is the official registered name; `organizations.name` stays the display / trading name. The legal name is
required to complete any business created through the canonical flow (`business_draft_submit` -> `app.organization_create_owned`),
nullable for historical organizations, and **private**: it is not in `organization_public_directory` or any anonymous projection.

### Referral approval (the other organization writers)

Two admin-approved paths also create a real organization and primary branch, deliberately *without* an Owner membership:
`showroom_referral_approve` (a Salesperson's referral) and `network_referral_approve` (an Installer's). When approval **creates** an organization:

* **The Admin must explicitly confirm the legal name.** `p_legal_name` is required (2..120 characters) and there is **no fallback**: a legal name the
  referrer typed on the referral row is user-submitted information, so the Admin form (`/admin/verifications`, "Approve as a new business") only
  *prefills* it and the Admin's submitted value is what becomes `organizations.legal_name`. An omitted / blank / invalid value is refused with `22023`
  before anything is written, even when the referral row has a legal name.
* **The referral's city is never dropped.** A canonical city of the governorate -> `city_key`; any other valid non-empty text -> `city_custom_name`;
  the literal Other / أخرى is never stored (it names no city); governorate-only is kept only when the referral supplied no city. A canonical city of a
  *different* governorate, an unrecognised governorate, a city without a governorate or a 1-character city is refused (`22023`, "enter the branch
  location") until the Admin corrects it with the optional branch-governorate / city fields on the same form (strictly validated).

**Linking to an existing organization is unchanged** and needs nothing. Provenance, Sales (never Owner) membership, Points and idempotency are
unchanged.

## Not unified yet (follow-up)

Consumer onboarding, professional onboarding, the professional profile editor and the showroom referral *submission* form still use the older
four-governorate vocabulary in `lib/onboarding/persona-fields.ts` (underscore keys). Moving them to this catalogue is a separate
change; the legacy map above is what makes it safe for stored values.
