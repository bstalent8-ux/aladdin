"use client";

import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { CATALOG_VIEW_COOKIE, type CatalogView } from "@/lib/ui/catalog-view";
import { GridIcon, ListIcon } from "@/components/ui/icons";

/** Remember the display mode per browser (a cookie the server also reads — no flash, no DB row). */
export function persistCatalogView(view: CatalogView) {
  try {
    document.cookie = `${CATALOG_VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* a blocked cookie only means the choice is not remembered */
  }
}

/**
 * The Grid / List switch shared by Browse products and My products, so the two
 * pages behave and look identically and remember one preference.
 */
export function ViewToggle({
  view,
  onChange,
  testIdPrefix,
}: {
  view: CatalogView;
  onChange: (next: CatalogView) => void;
  testIdPrefix: string;
}) {
  const { t } = useI18n();
  const choose = (next: CatalogView) => {
    onChange(next);
    persistCatalogView(next);
  };
  return (
    <div role="group" aria-label={t("showroomCatalog.display")} className="inline-flex rounded-sm border border-strong bg-surface p-0.5">
      <ToggleButton active={view === "grid"} label={t("showroomCatalog.grid")} onClick={() => choose("grid")} testId={`${testIdPrefix}-view-grid`}>
        <GridIcon size={16} />
      </ToggleButton>
      <ToggleButton active={view === "list"} label={t("showroomCatalog.list")} onClick={() => choose("list")} testId={`${testIdPrefix}-view-list`}>
        <ListIcon size={16} />
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  label,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        active ? "bg-primary text-primary-foreground" : "text-fg-secondary hover:bg-surface-2",
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
