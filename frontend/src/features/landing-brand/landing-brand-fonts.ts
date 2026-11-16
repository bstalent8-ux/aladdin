import localFont from "next/font/local";

/**
 * Brand typography for the public Landing page ONLY (design-system v1.1.0, brand-landing scope).
 * Hurme Geometric Sans covers Latin glyphs and digits; 29LT Bukra covers Arabic (and has Latin as a fallback), so the
 * two are stacked: Hurme first, Bukra second. Scoped as CSS variables on the landing wrapper — the rest of the app
 * keeps its Aperture fonts.
 *
 * PRELOAD: Bukra (Arabic: the h1 and the body copy, 37 KB) is preloaded; Hurme (Latin letters and digits only, three
 * weights, 152 KB) is NOT. On a slow phone connection the three Hurme files raced the hero image (the mobile LCP
 * element) for bandwidth and delayed it (measured: Slow 4G, LCP 4.3 s, image download 2.2 s). Hurme is `display: swap`,
 * so Latin text and digits paint in the fallback font and switch when the file arrives.
 */
export const hurme = localFont({
  src: [
    { path: "./fonts/Hurme-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Hurme-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Hurme-Bold.woff2", weight: "700 900", style: "normal" },
  ],
  variable: "--font-hurme",
  preload: false,
  // No metric-adjusted Arial fallback: it has Arabic glyphs, so it would shadow Bukra for Arabic text.
  adjustFontFallback: false,
  display: "swap",
});

export const bukra = localFont({
  src: [
    { path: "./fonts/Bukra-Regular.woff2", weight: "300 500", style: "normal" },
    { path: "./fonts/Bukra-Bold.woff2", weight: "600 900", style: "normal" },
  ],
  variable: "--font-bukra",
  adjustFontFallback: false,
  display: "swap",
});
