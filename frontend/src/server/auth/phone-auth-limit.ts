import "server-only";
import { createHmac } from "node:crypto";
import { readAuthIdentifierSecret, readPublicEnv } from "@/lib/env";
import { consumePhoneAuthLimit } from "@/lib/supabase/admin-server";
import { clientIpFrom } from "./turnstile";
export async function phoneAuthLimit(action: "sign-in" | "sign-up", phone: string, headers: {
    get(name: string): string | null;
}): Promise<"allowed" | "limited" | "unavailable"> {
    try {
        // Vercel overwrites this header at the trusted edge. Never trust arbitrary client XFF in hosted environments.
        const ip = readPublicEnv().NEXT_PUBLIC_APP_ENV === "local"
            ? clientIpFrom(name => headers.get(name))
            : clientIpFrom(name => name === "x-forwarded-for" ? headers.get("x-vercel-forwarded-for") : null);
        const secret = readAuthIdentifierSecret();
        const key = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
        return await consumePhoneAuthLimit(action, key("ip:" + (ip ?? "unknown")), key("phone:" + phone)) ? "allowed" : "limited";
    }
    catch {
        return "unavailable"; // no network/provider/config errors or PII escape to logs/responses
    }
}
