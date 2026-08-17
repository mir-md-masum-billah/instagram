"use client";

import { forwardRef, useState } from "react";
import Image from "next/image";
import { ImageOff, VideoOff, Loader2 } from "lucide-react";

function Skeleton() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background:
          "linear-gradient(100deg, var(--surface) 30%, var(--surface-2) 50%, var(--surface) 70%)",
        backgroundSize: "200% 100%",
        animation: "leakreels-shimmer 1.4s ease-in-out infinite",
      }}
    >
      <Loader2 size={22} className="animate-spin" style={{ color: "var(--muted)" }} />
      <style jsx>{`
        @keyframes leakreels-shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
      `}</style>
    </div>
  );
}

function Fallback({ video }) {
  const Icon = video ? VideoOff : ImageOff;
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5"
      style={{ background: "var(--surface)", color: "var(--muted)" }}
    >
      <Icon size={22} strokeWidth={1.5} />
      <span className="text-[11px] font-mono">{video ? "Video unavailable" : "Image unavailable"}</span>
    </div>
  );
}

// Wraps next/image with a shimmering placeholder while it loads and a
// friendly fallback if the media fails to load — so a slow/broken image
// never leaves a blank hole in the layout. Using next/image (instead of a
// plain <img>) means every image is actually resized and re-encoded
// (webp/avif) to fit where it's displayed instead of shipping the original
// file to every device — the original full-size upload was being sent to
// phones for a thumbnail-sized slot.
//
// Every call site renders this inside a `position: relative` box sized by
// wrapperClassName, so `fill` (rather than fixed width/height) is the right
// fit — the image always matches that box exactly.
export function MediaImage({
  src,
  alt,
  className,
  wrapperClassName,
  style,
  loading = "lazy",
  sizes = "(max-width: 768px) 100vw, 600px",
  priority = false,
}) {
  const [state, setState] = useState(src ? "loading" : "error");

  return (
    <div className={`relative overflow-hidden ${wrapperClassName || ""}`} style={style}>
      {state !== "error" && (
        <Image
          src={src}
          alt={alt || ""}
          fill
          sizes={sizes}
          className={className}
          style={{ objectFit: "cover", opacity: state === "loaded" ? 1 : 0, transition: "opacity 0.25s ease" }}
          loading={priority ? undefined : loading}
          priority={priority}
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
        />
      )}
      {state === "loading" && <Skeleton />}
      {state === "error" && <Fallback />}
    </div>
  );
}

// Same idea for <video>: shows a shimmer until the first frame is ready and
// a fallback icon if the video can't be loaded at all.
export const MediaVideo = forwardRef(function MediaVideo(
  { src, className, wrapperClassName, style, onLoadedData, onError, ...videoProps },
  ref
) {
  const [state, setState] = useState(src ? "loading" : "error");

  return (
    <div className={`relative overflow-hidden ${wrapperClassName || ""}`} style={style}>
      {state !== "error" && (
        <video
          ref={ref}
          src={src}
          className={className}
          style={{ opacity: state === "loaded" ? 1 : 0, transition: "opacity 0.25s ease" }}
          // Default to "metadata" so a video only downloads its dimensions
          // and poster frame up front, not the full file — callers can still
          // override this via videoProps, same as before.
          preload="metadata"
          onLoadedData={(e) => {
            setState("loaded");
            onLoadedData?.(e);
          }}
          onError={(e) => {
            setState("error");
            onError?.(e);
          }}
          {...videoProps}
        />
      )}
      {state === "loading" && <Skeleton />}
      {state === "error" && <Fallback video />}
    </div>
  );
});
