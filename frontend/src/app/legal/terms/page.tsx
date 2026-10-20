import type { Metadata } from "next";
import { LegalDocumentView } from "@/features/legal/legal-document";

export const metadata: Metadata = { title: "Terms of Service · Aladdin" };
export const dynamic = "force-dynamic";

export default function TermsPage() {
  return <LegalDocumentView documentKey="terms" />;
}