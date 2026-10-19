import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import { VideoGallery } from "./video-gallery";

const video = { id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", title: "Kitchen", durationSeconds: 12, width: 1280, height: 720,
  hasPoster: true, src: "https://media.example.test/v/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/master.m3u8",
  poster: "https://media.example.test/v/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/poster.jpg" };

it("renders on a public page without the client i18n provider, loading only the poster", () => {
  const html = renderToString(<VideoGallery videos={[video]} title="Videos" t={createTranslator("ar")} />);
  expect(html).toContain('preload="none"');
  expect(html).toContain(`poster="${video.poster}"`);
  expect(html).not.toContain("master.m3u8");
  expect(html).toContain("Kitchen");
});

it("renders nothing when there is nothing published", () => {
  expect(renderToString(<VideoGallery videos={[]} title="Videos" t={createTranslator("en")} />)).toBe("");
});
