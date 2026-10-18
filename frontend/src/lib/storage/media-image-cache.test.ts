import { expect, it } from "vitest";
import { hasLocalMatch } from "next/dist/shared/lib/match-local-pattern";
import config from "../../../next.config";

it("rejects revocable media from the actual installed Next optimizer matcher", () => {
  for (const url of ["/api/media/portfolio?key=x.png", "/api/media/certificate?key=x.pdf", "/p/media/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "/brand/../p/media/x"]) {
    expect(hasLocalMatch(config.images?.localPatterns, url)).toBe(false);
  }
});
it("preserves every existing static asset directory and build image imports", () => {
  for (const url of ["/brand/mark.png", "/assets/logo.png", "/demo/photo.png", "/installer-auth/hero.png", "/landing-v2/hero.png", "/preview/photo.png", "/_next/static/media/hash.png"]) {
    expect(hasLocalMatch(config.images?.localPatterns, url)).toBe(true);
  }
});
