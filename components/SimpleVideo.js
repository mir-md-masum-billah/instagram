"use client";

import { useRef, useState } from "react";
import { Volume2, VolumeX, Maximize2 } from "lucide-react";
import { MediaVideo } from "@/components/Media";
import VideoFullscreenPlayer from "@/components/VideoFullscreenPlayer";

export default function SimpleVideo({ src, className, poster }) {
  const videoRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [showFullscreen, setShowFullscreen] = useState(false);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }

  function openFullscreen(e) {
    e.stopPropagation();
    const v = videoRef.current;
    if (v) v.pause();
    setShowFullscreen(true);
  }

  // When the fullscreen viewer closes, pick up wherever the person left
  // off (scrub position + mute choice) so the inline preview keeps playing
  // from the same spot instead of jumping back to the start.
  function handleFullscreenClose({ time, muted: finalMuted }) {
    setShowFullscreen(false);
    const v = videoRef.current;
    if (v) {
      v.currentTime = time;
      v.muted = finalMuted;
      v.play().catch(() => {});
    }
    setMuted(finalMuted);
  }

  return (
    <div className="relative w-full h-full">
      <MediaVideo
        src={src}
        ref={videoRef}
        muted={muted}
        playsInline
        loop
        poster={poster || undefined}
        onClick={togglePlay}
        className={className}
        wrapperClassName="w-full h-full"
      />
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMuted((m) => !m);
        }}
        className="absolute bottom-2 right-2 p-2 rounded-full"
        style={{ background: "rgba(0,0,0,0.45)" }}
        aria-label={muted ? "Unmute" : "Mute"}
      >
        {muted ? <VolumeX size={16} color="white" /> : <Volume2 size={16} color="white" />}
      </button>
      <button
        onClick={openFullscreen}
        className="absolute top-2 right-2 p-2 rounded-full"
        style={{ background: "rgba(0,0,0,0.45)" }}
        aria-label="View fullscreen"
      >
        <Maximize2 size={16} color="white" />
      </button>

      {showFullscreen && (
        <VideoFullscreenPlayer
          src={src}
          poster={poster}
          initialTime={videoRef.current?.currentTime || 0}
          initialMuted={muted}
          onClose={handleFullscreenClose}
        />
      )}
    </div>
  );
}
