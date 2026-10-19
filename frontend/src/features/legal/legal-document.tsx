"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Card } from "@/components/ui/primitives";
import { Brand } from "@/components/layout/brand";
import { LEGAL_UPDATED_AT, legalDocument, type LegalBlock, type LegalDocumentKey } from "@/features/legal/content";

const RELATED: Record<LegalDocumentKey, { href: string; labelKey: "legal.seePrivacy" | "legal.seeDataDeletion" }> = {
  terms: { href: "/legal/privacy", labelKey: "legal.seePrivacy" },
  privacy: { href: "/legal/data-deletion", labelKey: "legal.seeDataDeletion" },
  dataDeletion: { href: "/legal/privacy", labelKey: "legal.seePrivacy" },
};

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === "p") return <p className="text-body text-fg-secondary">{block.text}</p>;
  const items = block.items.map((item) => <li key={item}>{item}</li>);
  return block.kind === "steps" ? (
    <ol className="flex list-decimal flex-col gap-xs ps-lg text-body text-fg-secondary">{items}</ol>
  ) : (
    <ul className="flex list-disc flex-col gap-xs ps-lg text-body text-fg-secondary">{items}</ul>
  );
}

/**
 * A published legal document (Terms of Service, Privacy Policy, Data Deletion Instructions) in
 * the visitor's locale. Public: no session needed (docs/frontend/legal-pages.md).
 */
export function LegalDocumentView({ documentKey }: { documentKey: LegalDocumentKey }) {
  const { t, locale } = useI18n();
  const doc = legalDocument(documentKey, locale);
  const related = RELATED[documentKey];
  const updated = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-EG", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${LEGAL_UPDATED_AT[documentKey]}T00:00:00Z`),
  );
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-lg px-md py-xl">
      <Card className="flex flex-col gap-lg">
        <header className="flex flex-col gap-md">
          <Link href="/" aria-label={t("legal.backToHome")} className="self-start">
            <Brand name={t("common.appName")} size="sm" />
          </Link>
          <h1 className="font-display-ar text-headline text-fg">{doc.title}</h1>
          <p className="text-label text-fg-muted">
            {doc.updatedLabel}: <time dateTime={LEGAL_UPDATED_AT[documentKey]}>{updated}</time>
          </p>
          <p className="text-body-lg text-fg-secondary">{doc.intro}</p>
        </header>

        <nav aria-label={doc.contentsLabel} className="flex flex-col gap-xs border-y border-strong py-md">
          <h2 className="text-label font-medium uppercase tracking-wide text-fg-muted">{doc.contentsLabel}</h2>
          <ol className="flex flex-col gap-xs">
            {doc.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="text-label text-accent hover:underline">
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {doc.sections.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="flex scroll-mt-lg flex-col gap-sm">
            <h2 id={`${section.id}-heading`} className="text-title font-semibold text-fg">
              {section.heading}
            </h2>
            {section.blocks.map((block, index) => (
              <Block key={index} block={block} />
            ))}
          </section>
        ))}

        <footer className="flex flex-wrap gap-md border-t border-strong pt-md">
          <Link href={related.href} className="text-label font-medium text-accent hover:underline">
            {t(related.labelKey)}
          </Link>
          <Link href="/" className="text-label font-medium text-accent hover:underline">
            {t("legal.backToHome")}
          </Link>
        </footer>
      </Card>
    </div>
  );
}
