import { test } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { prefs } from "../regression/util";
import { capture, DESK_EN_L, MOB_AR_D } from "./audit-util";
test("suite placeholder pages", async ({ page, request }) => {
  test.setTimeout(300_000);
  await prefs(page, { locale: "en", theme: "light" });
  await signIn(page, request, IDENTITIES.showroom);
  await capture(page, "/showroom/purchase-requests", { area: "existing-showroom-commerce", name: "p01-suite-purchase-requests-placeholder", persona: "Showroom/Dealer (hana)", state: "Sidebar item 'Purchase requests' in the Showroom suite: placeholder page", data: "empty-state", limitation: "Placeholder served by the generic [page] route" }, [DESK_EN_L, MOB_AR_D]);
  await capture(page, "/showroom/customer-rfqs", { area: "existing-showroom-commerce", name: "p02-suite-customer-rfqs-placeholder", persona: "Showroom/Dealer (hana)", state: "Sidebar item 'Customer RFQs received': placeholder page", data: "empty-state", limitation: "Placeholder served by the generic [page] route" }, [DESK_EN_L]);
});
