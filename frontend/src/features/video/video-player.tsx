"use client";

import { useEffect, useRef, useState } from "react";

type HlsInstance = { destroy(): void; loadSource(src: string): void; attachMedia(media: HTMLMediaElement): void;
  on(event: string, handler: (event: string, data: { fatal?: boolean }) => void): void };

/**
 * Adaptive (HLS) player for a video served by the media Worker.
 *
 * NOTHING LOADS UNTIL THE VIEWER ASKS. The poster is the only request a page
 * makes; the playlist, the segments and hls.js itself (about 120 kB) are fetched
 * when the viewer presses play. Safari and iOS play HLS natively and never load
 * hls.js. The aspect ratio comes from the stored dimensions, so the frame does
 * not shift the layout when the video starts.
 *
 * Labels come in as props: public pages render it without the client i18n provider.
 */
export function VideoPlayer({ src, poster, title, width, height, className, labels }: {
  src: string; poster: string | null; title: string; width: number | null; height: number | null; className?: string;
  labels: { play: string; unavailable: string };
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => hlsRef.current?.destroy(), []);

  async function start() {
    const video = videoRef.current;
    if (!video || started) return;
    setStarted(true);
    setFailed(false);
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    } else {
      const { default: Hls } = await import("hls.js/light");
      if (!Hls.isSupported()) { setFailed(true); return; }
      // Capped to the frame size so a phone does not download 1080p.
      const hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 30 }) as unknown as HlsInstance;
      hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setFailed(true); });
      hls.loadSource(src);
      hls.attachMedia(video);
      hlsRef.current = hls;
    }
    video.play().catch(() => undefined);
  }

  const ratio = width && height ? `${width} / ${height}` : "16 / 9";
  return (
    <div className={`relative w-full overflow-hidden rounded-md bg-black ${className ?? ""}`} style={{ aspectRatio: ratio }}
      data-testid="video-player">
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        poster={poster ?? undefined}
        preload="none"
        playsInline
        controls={started}
        aria-label={title}
        onError={() => setFailed(true)}
      />
      {!started && (
        <button
          type="button"
          onClick={start}
          className="absolute inset-0 flex items-center justify-center bg-black/20 text-white transition-colors hover:bg-black/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          aria-label={labels.play}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor" className="ms-1 h-7 w-7"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </button>
      )}
      {failed && (
        <p role="alert" className="absolute inset-x-0 bottom-0 bg-black/70 px-md py-2 text-label text-white">
          {labels.unavailable}
        </p>
      )}
    </div>
  );
}
