"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import type { WorkspaceEntry } from "@/lib/workspace/model";
import { BuildingIcon, ChevronDownIcon, CheckIcon, PlusIcon } from "@/components/ui/icons";
import { menuItemClass, menuSectionLabelClass, menuSurfaceClass } from "@/components/ui/menu";
import { selectShowroomWorkspace } from "./workspace-action";
import { eligibleWorkspaces, isShowroomBusinessType, SHOWROOM_BUSINESS_LABELS } from "./workspace-model";

export function ShowroomWorkspaceMenu({ entries, activeKey, canCreate }: { entries: WorkspaceEntry[]; activeKey: string; canCreate: boolean }) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const businesses = eligibleWorkspaces(entries);
  const active = businesses.find((entry) => entry.organizationId === activeKey);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return <div ref={root} className="relative min-w-0">
    <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t("workspace.switch")} disabled={pending} onClick={() => setOpen(!open)} className="flex h-7 min-w-0 max-w-[min(16rem,62vw)] items-center gap-1.5 rounded-sm px-2 text-label font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-60 tablet:max-w-40 desktop:max-w-64" title={active?.name}>
      <BuildingIcon size={16} className="shrink-0 text-fg-muted" /><span dir="auto" className="truncate">{active?.name ?? t("workspace.title")}</span><ChevronDownIcon size={14} className="shrink-0" />
    </button>
    {open ? <div role="menu" aria-label={t("workspace.title")} className={`${menuSurfaceClass} absolute start-0 top-full z-popover mt-1 w-64 max-w-[calc(100vw-2rem)] max-h-[60dvh] overflow-y-auto`} onKeyDown={(event) => {
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
      if (event.key === "Tab") setOpen(false);
    }}>
      <p className={`${menuSectionLabelClass} px-3 pb-1 pt-2.5`}>{t("workspace.title")}</p>
      {businesses.map((entry) => <button key={entry.organizationId} type="button" role="menuitem" disabled={pending} className={menuItemClass(entry.organizationId === activeKey)} onClick={() => start(async () => {
        setError(false);
        const result = await selectShowroomWorkspace(entry.organizationId);
        setError(result.error);
      })}>
        <BuildingIcon size={16} className="shrink-0" /><span className="flex min-w-0 flex-col"><span className="truncate">{entry.name}</span><span className="text-label text-fg-muted">{isShowroomBusinessType(entry.orgType) ? SHOWROOM_BUSINESS_LABELS[entry.orgType][locale] : ""}</span></span>{entry.organizationId === activeKey ? <CheckIcon size={16} className="ms-auto shrink-0" /> : null}
      </button>)}
      {canCreate ? <Link role="menuitem" href="/preview/showroom-suite-v2/add-business" onClick={() => setOpen(false)} className={`${menuItemClass(false)} border-t`}><PlusIcon size={16} />{locale === "ar" ? "إضافة نشاط تجاري" : "Add business activity"}</Link> : null}
      {canCreate ? <Link role="menuitem" href="/business/applications" onClick={() => setOpen(false)} className={menuItemClass(false)}><BuildingIcon size={16} />{locale === "ar" ? "طلبات المؤسسات" : "Organization applications"}</Link> : null}
      {error ? <p role="alert" className="px-3 py-2 text-label text-danger">{locale === "ar" ? "تعذر التبديل. حدّث الصفحة للتحقق من صلاحياتك." : "Could not switch. Refresh to check your access."}</p> : null}
    </div> : null}
  </div>;
}
