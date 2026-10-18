import type { Metadata } from "next";
import { LegalDocumentView } from "@/features/legal/legal-document";

export const metadata: Metadata = { title: "Privacy Policy · Aladdin" };
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return <LegalDocumentView documentKey="privacy" />;
}
