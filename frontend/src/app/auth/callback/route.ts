import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { completeEntryOAuth, isEntryKind } from "@/server/auth/entry-oauth";

export const dynamic = "force-dynamic";

/**
 * Google/Facebook return here (through Supabase Auth) from the Showroom and
 * Installer entry pages. The session cookies written by the code exchange ride
 * the redirect response. See `completeEntryOAuth` for every rule.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const entry = params.get("entry");
  if (!isEntryKind(entry)) return NextResponse.redirect(new URL("/auth/sign-in", request.url));
  const supabase = await getServerSupabase();
  const outcome = await completeEntryOAuth(supabase, {
    code: params.get("code"),
    kind: entry,
    next: params.get("next"),
    providerError: params.get("error"),
  });
  return NextResponse.redirect(new URL(outcome.path, request.url));
}
