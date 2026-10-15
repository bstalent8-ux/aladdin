"use client";

import { useEffect, useState } from "react";
import { PackageIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * The image on a product card.
 *
 * A finishing catalogue is a catalogue of SURFACES — a buyer picks a floor tile
 * by looking at it, and a grid of grey boxes with names on them is a spreadsheet
 * with extra steps. So where `image_ref` exists, it is shown at a fixed 4:3 ratio
 * so the grid keeps its rhythm no matter what the supplier uploaded.
 *
 * A plain `<img>`, not `next/image`: `image_ref` is a free-text reference a
 * supplier controls, `next/image` would need every possible host allow-listed in
 * `next.config`, and an un-allow-listed host throws at render — one bad reference
 * would take down the whole catalog page. Lazy loading and `decoding="async"`
 * give the part of `next/image` that actually matters here.
 *
 * With no image, the card falls back to a neutral marked panel rather than an
 * empty box or a broken-image glyph: "no photo yet" is information, a broken
 * icon is a bug report.
 *
 * Signed photo URLs live five minutes. If one has expired by the time the browser asks for it (a page
 * left open, a lazily loaded image, a restored tab), the photo asks the server for a fresh URL once and
 * falls back to the placeholder if the caller may no longer see it.
 */
export function ProductMedia({
  src,
  alt,
  className,
  aspect = "aspect-[4/3]",
}: {
  src: string | null;
  /** The product name — never "product image", which tells a screen reader nothing. */
  alt: string;
  className?: string;
  /** Tailwind aspect class. The production grid keeps 4:3; compact surfaces pass their own. */
  aspect?: string;
}) {
  const [current, setCurrent] = useState<string | null>(src);
  const [retried, setRetried] = useState(false);
  useEffect(() => {
    setCurrent(src);
    setRetried(false);
  }, [src]);

  async function refresh() {
    if (retried || !current || !current.includes("/storage/v1/object/sign/")) {
      setCurrent(null);
      return;
    }
    setRetried(true);
    try {
      const { refreshProductImageUrlAction } = await import("@/server/actions/product-image-refresh");
      const scope = window.location.pathname.startsWith("/home") ? "personal" : "workspace";
      setCurrent(await refreshProductImageUrlAction(current, scope));
    } catch {
      setCurrent(null);
    }
  }

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-sm bg-surface-2",
        aspect,
        className,
      )}
    >
      {current ? (
        /* next/image is not usable here — see the component note above. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={current}
          onError={refresh}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-fg-muted" aria-hidden="true">
          <PackageIcon size={28} />
        </div>
      )}
    </div>
  );
}
