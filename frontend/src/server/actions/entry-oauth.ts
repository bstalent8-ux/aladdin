"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { entryCallbackUrl, entrySignInPath, isEntryKind, isOAuthProvider } from "@/server/auth/entry-oauth";

/**
 * Starts Google/Facebook sign-in or sign-up from a Showroom/Installer entry
 * page. The callback URL is built on the CURRENT request's own origin — never
 * a caller-supplied value — and Supabase must list it as an allowed redirect.
 */
export async function startEntryOAuth(formData: FormData): Promise<void> {
  const kind = formData.get("kind");
  const provider = formData.get("provider");
  if (!isEntryKind(kind)) redirect("/auth/sign-in");
  if (!isOAuthProvider(provider)) redirect(`${entrySignInPath(kind)}?error=oauth`);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");

  let url: string | undefined;
  try {
    const supabase = await getServerSupabase();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: entryCallbackUrl(`${proto}://${host}`, kind, formData.get("next")),
        skipBrowserRedirect: true,
        ...(provider === "google" ? { queryParams: { prompt: "select_account" } } : {}),
      },
    });
    if (!error) url = data.url ?? undefined;
  } catch {
    url = undefined;
  }
  redirect(url ?? `${entrySignInPath(kind)}?error=oauth`);
}
