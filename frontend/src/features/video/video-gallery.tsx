import type { TranslateFn } from "@/lib/i18n/translate";
import type { VideoPlayback } from "@/server/video/playback";
import { VideoPlayer } from "./video-player";

/**
 * Read-only videos (a public profile, a product page). Renders nothing when
 * there is nothing: a visitor cannot tell "no videos" from "private videos".
 * Players load nothing but their poster until the viewer presses play.
 */
export function VideoGallery({ videos, title, t }: {
  videos: VideoPlayback[]; title: string; t: TranslateFn;
}) {
  if (videos.length === 0) return null;
  return (
    <section className="flex flex-col gap-md" aria-label={title} data-testid="video-gallery">
      <h2 className="text-title text-fg">{title}</h2>
      <ul className="grid gap-lg sm:grid-cols-2">
        {videos.map((video) => (
          <li key={video.id} className="flex flex-col gap-1">
            <VideoPlayer src={video.src} poster={video.poster} title={video.title} width={video.width} height={video.height}
              labels={{ play: t("video.play", { title: video.title }), unavailable: t("video.unavailable") }} />
            <p className="text-label text-fg">{video.title}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
