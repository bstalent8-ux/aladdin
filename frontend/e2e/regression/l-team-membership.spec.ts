import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { REG, createSyntheticUser, psql, signedInClient } from "./setup";
import { prefs } from "./util";

/**
 * BATCH L (B3-B) - team invitations and join requests, through the real UI and RPCs.
 *
 * Owner = Cairo Ceramics Showroom (hana). Invitee / salesperson = fresh synthetic accounts (local DB only, email-confirmed,
 * known E2E password). Nothing here adds privileges: roles are the existing ROLE_PRESETS, and every grant goes through
 * `membership_set_capabilities` (no-escalation rule). The Showroom owner's Team page is /b2b/organization.
 */
const q = (s: string) => psql(s).trim();
const OWNER = IDENTITIES.showroom;
const RUN = Date.now().toString(36);
const orgId = () => q(`select o.id from public.organizations o join public.memberships m on m.organization_id = o.id join auth.users u on u.id = m.user_id where u.email = '${OWNER}' limit 1`);
const membership = (userId: string) => q(`select id from public.memberships where user_id = '${userId}' and organization_id = '${orgId()}'`);
const mStatus = (userId: string) => q(`select coalesce((select status::text from public.memberships where user_id = '${userId}' and organization_id = '${orgId()}'), 'none')`);
const caps = (mid: string) => q(`select coalesce(string_agg(capability_key, ',' order by capability_key), '') from public.membership_capabilities where membership_id = '${mid}'`);
const audit = (mid: string, action: string) => Number(q(`select count(*) from public.audit_log where subject_id = '${mid}' and action = '${action}'`));

function newUser(tag: string, persona: string): { id: string; email: string; name: string } {
  const email = `reg-${tag}-${RUN}@example.test`;
  const name = `Reg ${tag} ${RUN}`;
  const id = createSyntheticUser(email, persona);
  q(`update public.profiles set display_name = '${name}' where user_id = '${id}'`);
  return { id, email, name };
}

async function login(page: Page, request: APIRequestContext, email: string, landing: RegExp = /\/(home|b2b|onboarding|preview)/) {
  await page.context().clearCookies();
  await prefs(page, { locale: "en" });
  await signIn(page, request, email, landing);
}
async function open(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState("networkidle");
}
/** The member / request card for a person, scoped by the unique display name. */
const cardFor = (page: Page, name: string, within: string) =>
  page.locator("div, li").filter({ has: page.getByText(name, { exact: true }) }).filter({ has: page.getByRole("button", { name: within }) }).last();

test.describe("team invitations", () => {
  test("L1 invite by email -> accept -> role -> escalation refused -> suspend/reactivate -> revoke", async ({ page, request }) => {
    test.setTimeout(300_000);
    const invitee = newUser("invitee", "sales");

    // BEFORE: no membership, no access to the owner's workspace or its team page.
    await login(page, request, invitee.email);
    expect(mStatus(invitee.id)).toBe("none");
    await page.goto("/b2b/organization");
    await expect(page.getByRole("button", { name: "Create invitation" })).toHaveCount(0);

    // OWNER invites by email through the real form.
    await login(page, request, OWNER, /\/b2b|\/preview/);
    await open(page, "/b2b/organization");
    await page.getByLabel("Work email").fill(invitee.email);
    await page.getByRole("button", { name: "Create invitation" }).click();
    // The app creates the invitation and hands the link back ("link ready"); it does NOT dispatch an email (no sender is wired).
    await expect(page.getByText("Invitation link ready")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Invitation sent by email.")).toHaveCount(0);
    const token = q(`select token from public.organization_invitations where email = '${invitee.email}' and organization_id = '${orgId()}' and status = 'pending'`);
    expect(token.length).toBeGreaterThan(20);
    expect(mStatus(invitee.id), "an invitation is not a membership").toBe("none");

    // A DIFFERENT account cannot use the link (the invitation is bound to the address).
    const stranger = newUser("stranger", "sales");
    const strangerClient = await signedInClient(stranger.email);
    const wrong = await strangerClient.rpc("invitation_accept", { p_token: token });
    expect(wrong.error?.code).toBe("42501");
    expect(mStatus(stranger.id)).toBe("none");

    // INVITEE accepts through the UI.
    await login(page, request, invitee.email);
    await open(page, `/auth/invite/${token}`);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect.poll(() => mStatus(invitee.id), { timeout: 20_000 }).toBe("active");
    const mid = membership(invitee.id);
    expect(caps(mid), "accepting grants no capability by itself").toBe("");
    expect(audit(mid, "membership.granted")).toBe(1);
    expect(q(`select status from public.organization_invitations where token = '${token}'`)).toBe("accepted");

    // Without a role the new member cannot manage people.
    await open(page, "/b2b/organization");
    await expect(page.getByRole("button", { name: "Create invitation" })).toHaveCount(0);
    await expect(page.getByText("You're not allowed to manage members here.")).toBeVisible();
    const me = await signedInClient(invitee.email);
    expect((await me.rpc("invitation_create", { p_org_id: orgId(), p_email: "x@example.test" })).error?.code).toBe("42501");
    expect((await me.rpc("membership_set_capabilities", { p_membership_id: mid, p_capabilities: ["org.manage"] })).error?.code, "self-escalation").toBe("42501");
    expect(caps(mid)).toBe("");

    // OWNER assigns the Salesperson role through the UI; the preset's capabilities apply, nothing more.
    await login(page, request, OWNER, /\/b2b|\/preview/);
    await open(page, "/b2b/organization");
    const card = cardFor(page, invitee.name, "Apply role");
    await card.getByRole("combobox", { name: "Assign role…" }).click();
    await page.getByRole("option", { name: "Salesperson" }).click();
    await card.getByRole("button", { name: "Apply role" }).click();
    await expect.poll(() => caps(mid), { timeout: 20_000 }).toBe("sales.read,sales.write");
    expect(audit(mid, "membership.role_changed")).toBe(1);

    // The salesperson reaches the sales workspace but still cannot manage people or place RFQs.
    await login(page, request, invitee.email);
    await open(page, "/b2b/leads");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(await page.getByText("You're not allowed").count()).toBe(0);
    expect((await me.rpc("membership_set_capabilities", { p_membership_id: mid, p_capabilities: ["sales.read", "sales.write", "org.members.manage"] })).error?.code).toBe("42501");
    const supplier = q(`select id from public.organizations where name like 'Suez Paints%' limit 1`);
    expect((await me.rpc("create_rfq", { p_requester_org_id: orgId(), p_supplier_org_id: supplier, p_title: "should be refused" })).error?.code).toBe("42501");
    expect(caps(mid)).toBe("sales.read,sales.write");

    // OWNER suspends, the member is locked out, reactivation restores access.
    await login(page, request, OWNER, /\/b2b|\/preview/);
    await open(page, "/b2b/organization");
    await cardFor(page, invitee.name, "Suspend").getByRole("button", { name: "Suspend" }).click();
    await expect.poll(() => mStatus(invitee.id), { timeout: 20_000 }).toBe("suspended");
    expect((await me.from("leads").select("id").limit(1)).data ?? [], "a suspended member reads no business data").toHaveLength(0);
    await cardFor(page, invitee.name, "Reactivate").getByRole("button", { name: "Reactivate" }).click();
    await expect.poll(() => mStatus(invitee.id), { timeout: 20_000 }).toBe("active");

    // OWNER revokes. The old link cannot bring the person back; access is gone; history stays.
    await open(page, "/b2b/organization");
    await cardFor(page, invitee.name, "Revoke").getByRole("button", { name: "Revoke" }).click();
    await expect.poll(() => mStatus(invitee.id), { timeout: 20_000 }).toBe("revoked");
    expect(audit(mid, "membership.revoked")).toBe(1);
    await login(page, request, invitee.email);
    await open(page, `/auth/invite/${token}`);
    const again = await me.rpc("invitation_accept", { p_token: token });
    expect(again.error?.code ?? "ok", "re-using an accepted link").not.toBe("42501");
    expect(mStatus(invitee.id), "an old accepted link never reactivates a revoked member").toBe("revoked");
    await page.goto("/b2b/organization");
    await expect(page.getByRole("button", { name: "Create invitation" })).toHaveCount(0);
    expect(Number(q(`select count(*) from public.memberships where id = '${mid}'`)), "the membership row is kept as history").toBe(1);
  });

  test("L2 a People manager cannot grant what they do not hold, and another organization cannot touch this team", async () => {
    const manager = newUser("pmanager", "sales");
    const target = newUser("target", "sales");
    const owner = await signedInClient(OWNER);
    // grant the manager the People-manager preset and a plain membership to the target, through the real RPCs
    for (const u of [manager, target]) {
      const inv = (await owner.rpc("invitation_create", { p_org_id: orgId(), p_email: u.email })).data as string;
      const c = await signedInClient(u.email);
      expect((await c.rpc("invitation_accept", { p_token: inv })).error).toBeNull();
    }
    expect((await owner.rpc("membership_set_capabilities", { p_membership_id: membership(manager.id), p_capabilities: ["org.members.manage"] })).error).toBeNull();
    const mgr = await signedInClient(manager.email);
    // no escalation: cannot grant org.manage or a key they do not hold
    for (const key of ["org.manage", "catalog.write", "sales.manage"]) {
      const r = await mgr.rpc("membership_set_capabilities", { p_membership_id: membership(target.id), p_capabilities: [key] });
      expect(r.error?.code, `grant ${key}`).toBe("42501");
    }
    expect(caps(membership(target.id))).toBe("");
    // can grant what they hold
    expect((await mgr.rpc("membership_set_capabilities", { p_membership_id: membership(target.id), p_capabilities: ["org.members.manage"] })).error).toBeNull();
    // cannot remove the last owner
    const ownerMid = q(`select m.id from public.memberships m join auth.users u on u.id = m.user_id where u.email = '${OWNER}' and m.organization_id = '${orgId()}'`);
    expect((await mgr.rpc("membership_revoke", { p_membership_id: ownerMid })).error, "a People manager revoking the owner").not.toBeNull();
    expect(mStatus(q(`select user_id from public.memberships where id = '${ownerMid}'`))).toBe("active");

    // CROSS-ORGANIZATION: the Distributor's owner cannot see, change or revoke this team, nor invite into it.
    const rania = await signedInClient(IDENTITIES.distributor);
    expect((await rania.rpc("org_members_list", { p_org_id: orgId() })).data ?? []).toHaveLength(0);
    expect((await rania.rpc("membership_set_capabilities", { p_membership_id: membership(target.id), p_capabilities: ["viewer"] })).error?.code).toBeTruthy();
    expect((await rania.rpc("membership_revoke", { p_membership_id: membership(target.id) })).error?.code).toBe("42501");
    expect((await rania.rpc("invitation_create", { p_org_id: orgId(), p_email: "intruder@example.test" })).error?.code).toBe("42501");
    expect((await rania.from("organization_invitations").select("id").eq("organization_id", orgId())).data ?? []).toHaveLength(0);
    expect(mStatus(target.id)).toBe("active");
  });
});

test.describe("join requests", () => {
  test("L3 a salesperson requests the showroom: pending grants nothing, decline is survivable, approval opens the workspace", async ({ page, request }) => {
    test.setTimeout(300_000);
    const sp = newUser("joiner", "sales");
    const showroomName = q(`select name from public.organizations where id = '${orgId()}'`);

    // REQUEST through the supported UI.
    await login(page, request, sp.email);
    await open(page, "/home/showroom");
    await page.locator("#q").fill(showroomName.slice(0, 8));
    await page.getByRole("button", { name: /^search$/i }).click();
    await page.getByRole("link", { name: new RegExp(showroomName, "i") }).first().click();
    await page.getByRole("button", { name: "Request to join" }).click();
    await page.waitForURL(/connected=pending/, { waitUntil: "commit" });
    const reqId = q(`select id from public.organization_join_requests where user_id = '${sp.id}' and organization_id = '${orgId()}' and status = 'pending'`);
    expect(reqId).toMatch(/^[0-9a-f-]{36}$/);

    // PENDING: no membership, no business workspace, no team access.
    expect(mStatus(sp.id)).toBe("none");
    await page.goto("/b2b");
    await expect(page).toHaveURL(/\/home/);
    const spClient = await signedInClient(sp.email);
    expect(((await spClient.rpc("my_workspaces")).data as Array<{ kind: string }>).filter((w) => w.kind === "business")).toHaveLength(0);
    expect((await spClient.rpc("org_join_request_approve", { p_request_id: reqId })).error?.code, "a requester cannot approve their own request").toBe("42501");

    // CROSS-ORGANIZATION: another business's owner cannot decide this request.
    const rania = await signedInClient(IDENTITIES.distributor);
    expect((await rania.rpc("org_join_request_approve", { p_request_id: reqId })).error?.code).toBe("42501");
    expect((await rania.rpc("org_join_request_reject", { p_request_id: reqId, p_reason: "no" })).error?.code).toBe("42501");
    expect(q(`select status from public.organization_join_requests where id = '${reqId}'`)).toBe("pending");

    // OWNER declines first, with a reason, through the UI.
    await login(page, request, OWNER, /\/b2b|\/preview/);
    await open(page, "/b2b/organization");
    const row = page.getByRole("listitem").filter({ hasText: sp.name });
    await expect(row).toBeVisible();
    await row.getByLabel("Reason for declining").fill("Please ask your branch manager first");
    await row.getByRole("button", { name: "Decline" }).click();
    await page.waitForURL(/decided=1/, { waitUntil: "commit" });
    expect(q(`select status from public.organization_join_requests where id = '${reqId}'`)).toBe("rejected");
    expect(mStatus(sp.id)).toBe("none");

    // The requester sees the decision, is not locked out of the personal account, and may ask again.
    await login(page, request, sp.email);
    await expect(page.getByText(/connection declined/i)).toBeVisible();
    await expect(page.getByText(/ask your branch manager/i)).toBeVisible();
    await open(page, "/home/showroom");
    await page.locator("#q").fill(showroomName.slice(0, 8));
    await page.getByRole("button", { name: /^search$/i }).click();
    await page.getByRole("link", { name: new RegExp(showroomName, "i") }).first().click();
    await page.getByRole("button", { name: "Request to join" }).click();
    await page.waitForURL(/connected=pending/, { waitUntil: "commit" });

    // OWNER approves.
    await login(page, request, OWNER, /\/b2b|\/preview/);
    await open(page, "/b2b/organization");
    const row2 = page.getByRole("listitem").filter({ hasText: sp.name }).filter({ has: page.getByRole("button", { name: "Approve and add to team" }) });
    await row2.getByRole("button", { name: "Approve and add to team" }).click();
    await expect.poll(() => mStatus(sp.id), { timeout: 20_000 }).toBe("active");
    const mid = membership(sp.id);
    // The approved "salesperson" grant (app.membership_grant_sales), pinned so any drift is a deliberate decision.
    expect(caps(mid)).toBe(
      "catalog.read,conversation.participate,project.read,quote.submit,rfq.create,rfq.respond,sales.followup.send,sales.match.share,sales.opportunity.read,sales.opportunity.write,sales.task.write",
    );
    expect(caps(mid)).not.toMatch(/org\.|branch\.|catalog\.(write|publish)|order\.|quote\.decide|sales\.(manage|assign)/);

    // WORKSPACE access after approval; still no management powers.
    await login(page, request, sp.email);
    await open(page, "/b2b/leads");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect((await spClient.rpc("membership_set_capabilities", { p_membership_id: mid, p_capabilities: ["org.manage"] })).error?.code, "escalation by the approved salesperson").toBe("42501");
    expect((await spClient.rpc("invitation_create", { p_org_id: orgId(), p_email: "x@example.test" })).error?.code).toBe("42501");

    // Approving twice is idempotent (one membership), and revocation removes access but keeps history.
    const owner = await signedInClient(OWNER);
    expect((await owner.rpc("org_join_request_approve", { p_request_id: q(`select id from public.organization_join_requests where user_id = '${sp.id}' and status = 'approved' limit 1`) })).data).toBe(mid);
    expect(Number(q(`select count(*) from public.memberships where user_id = '${sp.id}' and organization_id = '${orgId()}'`))).toBe(1);
    expect((await owner.rpc("membership_revoke", { p_membership_id: mid })).error).toBeNull();
    expect(mStatus(sp.id)).toBe("revoked");
    expect(((await spClient.rpc("my_workspaces")).data as Array<{ kind: string }>).filter((w) => w.kind === "business")).toHaveLength(0);
  });

  test("L4 only a salesperson can ask to join a showroom, and only a showroom can be asked", async () => {
    const engineer = await signedInClient(REG.multiEmail); // persona engineer
    const supplier = q(`select id from public.organizations where name like 'Suez Paints%' limit 1`);
    expect((await engineer.rpc("showroom_join_request_create", { p_organization_id: orgId() })).error?.code, "non-sales persona").toBe("42501");
    const sp = newUser("wrongorg", "sales");
    const c = await signedInClient(sp.email);
    expect((await c.rpc("showroom_join_request_create", { p_organization_id: supplier })).error?.code, "a supplier is not a showroom").toBe("22023");
    const ghost = await c.rpc("showroom_join_request_create", { p_organization_id: "00000000-0000-4000-8000-000000000000" });
    expect(ghost.error?.code).toBe("42501");
    expect(Number(q(`select count(*) from public.organization_join_requests where user_id = '${sp.id}'`))).toBe(0);
  });
});
