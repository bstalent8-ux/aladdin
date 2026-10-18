import type { Metadata } from "next";
import { LegalDocumentView } from "@/features/legal/legal-document";

export const metadata: Metadata = { title: "Data Deletion Instructions · Aladdin" };
export const dynamic = "force-dynamic";

export default function DataDeletionPage() {
  return <LegalDocumentView documentKey="dataDeletion" />;
}
