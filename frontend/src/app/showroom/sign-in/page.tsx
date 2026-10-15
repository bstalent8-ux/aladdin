import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { sanitizeNext } from "@/server/auth/next";
import { ShowroomAuthShell } from "@/features/showroom-auth/shell";
import { ShowroomAuthForm } from "@/features/showroom-auth/form";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "تسجيل الدخول إلى حساب المعرض — علاء الدين" };
export default async function ShowroomPage({ searchParams }: {
    searchParams: Promise<{
        next?: string;
    }>;
}) {
    const { data: { user } } = await (await getServerSupabase()).auth.getUser();
    if (user)
        redirect("/onboarding");
    const { next } = await searchParams;
    return <ShowroomAuthShell variant="signIn"><ShowroomAuthForm variant="signIn" next={sanitizeNext(next)}/></ShowroomAuthShell>;
}
