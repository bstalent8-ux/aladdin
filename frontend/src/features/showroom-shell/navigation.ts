import { HomeIcon, ClipboardIcon, StorefrontIcon, UserIcon, BriefcaseIcon, GiftIcon, SettingsIcon, StarIcon, ScrollIcon } from "@/components/ui/icons";
import type { InstallerNavItem } from "@/features/installer-dashboard-preview/installer-nav";
import { NAV_CAPS } from "@/lib/nav/modules";

export const SHOWROOM_ROOT = "/preview/showroom-suite-v2";
export type ShowroomNavItem = InstallerNavItem & { href: string; capabilities: readonly string[] };
const item = (id: string, ar: string, en: string, Icon: InstallerNavItem["Icon"], capabilities: string[] = []): ShowroomNavItem => ({ id, label: { ar, en }, Icon, href: `${SHOWROOM_ROOT}/${id}`, capabilities });
export const SHOWROOM_GROUPS = [
  { label: { ar: "", en: "" }, items: [item("home", "الرئيسية", "Home", HomeIcon)] },
  { label: { ar: "المشتريات", en: "Purchasing" }, items: [
    item("purchase-requests", "طلبات الشراء", "Purchase requests", ClipboardIcon, ["rfq.create"]),
    item("pricing-requests-sent", "طلبات عروض أسعار صادرة", "RFQs sent to suppliers", ScrollIcon, ["rfq.create"]),
    item("quotes-received", "عروض أسعار واردة", "Supplier quotations received", ScrollIcon, ["quote.decide", "rfq.create"]),
    item("purchase-orders", "أوامر الشراء", "Purchase orders", ClipboardIcon, NAV_CAPS.orders ?? []),
  ] },
  { label: { ar: "المبيعات", en: "Sales" }, items: [
    item("customer-rfqs", "طلبات عروض أسعار واردة", "Customer RFQs received", ScrollIcon, ["rfq.respond"]),
    item("customer-quotes", "عروض أسعار صادرة", "Quotations sent to customers", ScrollIcon, ["rfq.respond"]),
    item("customers", "العملاء", "Customers", UserIcon, NAV_CAPS.customers ?? []),
  ] },
  { label: { ar: "المنتجات", en: "Products" }, items: [
    item("catalog", "تصفح المنتجات", "Browse products", StorefrontIcon, NAV_CAPS.catalog ?? []),
    item("saved", "المنتجات المحفوظة", "Saved products", StarIcon, NAV_CAPS.saved ?? []),
    item("my-products", "منتجاتي", "My products", StorefrontIcon, NAV_CAPS.products ?? []),
  ] },
  { label: { ar: "الشبكة", en: "Network" }, items: [
    item("suppliers", "الموردون", "Suppliers", StorefrontIcon),
    item("craftsmen", "الصنايعية", "Craftsmen", UserIcon),
    item("jobs", "فرص العمل", "Job opportunities", BriefcaseIcon, NAV_CAPS.jobs ?? []),
  ] },
  { label: { ar: "الفريق", en: "Team" }, items: [item("sales-team", "فريقي - البائعين", "My sales team", UserIcon, NAV_CAPS.team ?? [])] },
  { label: { ar: "إدارة النشاط", en: "Business management" }, items: [
    item("projects", "المشاريع", "Projects", BriefcaseIcon, NAV_CAPS.projects ?? []),
    item("reports", "التقارير والتحليلات", "Reports & analytics", ScrollIcon, NAV_CAPS.reports ?? []),
    item("points", "النقاط", "Points", GiftIcon),
    item("settings", "الإعدادات", "Settings", SettingsIcon),
  ] },
];
export function canNavigate(item: ShowroomNavItem, capabilities: readonly string[]) {
  return !item.capabilities.length || capabilities.includes("org.manage") || item.capabilities.some((cap) => capabilities.includes(cap));
}
export function showroomNavigation(capabilities: readonly string[]) {
  return SHOWROOM_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => canNavigate(item, capabilities)) })).filter((group) => group.items.length);
}
