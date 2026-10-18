# Legal pages

Public, no sign-in (`/legal/*` is outside every middleware guard), English and Arabic from the `NEXT_LOCALE` cookie, light and dark.

| Route | Content | Status |
| --- | --- | --- |
| `/legal/privacy` | Privacy Policy | Published 2026-10-17 |
| `/legal/data-deletion` | Data Deletion Instructions (Meta's "User data deletion" URL) | Published 2026-10-17 |
| `/legal/terms` | Terms of Service | Placeholder (`LegalPending`) |

- Copy lives in `frontend/src/features/legal/content.ts` (one typed document per locale); `LegalDocumentView` renders it. Change the copy when product behaviour changes and bump `LEGAL_UPDATED_AT`.
- Contact inbox for privacy and deletion requests: `info@aladdindecore.com` (owner's choice). It must stay monitored.
- Deletion is request-based: there is no in-app delete-account action yet. A request is verified, then the account and its data are deleted within 30 days; records the law requires (consent receipts, security logs, records shared with other users such as RFQs or quotes) may be kept or de-identified as the policy states. If an in-app deletion or a Meta data-deletion callback is added, update both documents.
- Processors named in the policy: Supabase (database, auth, storage; EU region), Vercel (hosting), Cloudflare Turnstile (bot protection), Google and Meta (only when the person signs in with them). No analytics or advertising trackers.
- Tests: `frontend/src/features/legal/legal-document.test.tsx`.
