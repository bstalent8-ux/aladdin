import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * No cart in this release. The Marketplace shows real, published products only
 * and has no purchase flow yet ("online ordering coming soon" on every product
 * page); the former guest-cart preview ran on sample products, so it is closed
 * rather than shown next to real data. The sample components stay in the tree
 * (`features/marketplace/marketplace-cart-page.tsx`) for the future checkout.
 */
export default function MarketplaceCartRoute() {
  notFound();
}
