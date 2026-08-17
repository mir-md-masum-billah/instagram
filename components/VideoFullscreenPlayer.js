"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, Play, Pause, Volume2, VolumeX, RotateCcw, RotateCw, Maximize2, Minimize2 } from "lucide-react";

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Fullscreen "theater" viewer for a single video — opened from anywhere a
// video is shown (feed cards, post modal, single-post page) via an expand
// button. Everything else on the page is hidden behind this full-viewport
// overlay while it's open.
//
// Controls, YouTube-style:
//  - tap center: play/pause
//  - double-tap left third / right third: seek -5s / +5s (with a flash icon)
//  - bottom bar: play/pause, elapsed/duration, draggable seek bar, mute
//  - controls auto-hide a couple seconds after playback starts, and come
//    back on any tap/move; always visible while paused
export default function VideoFullscreenPlayer({
  src,
  poster,
  initialTime = 0,
  initialMuted = true,
  onClose,
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimerRef = useRef(null);
  const tapRef = useRef({ time: 0, zone: null, timer: null });

  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(initialMuted);
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [skipFlash, setSkipFlash] = useState(null); // 'left' | 'right' | null
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [seeking, setSeeking] = useState(false);

  const close = useCallback(() => {
    const v = videoRef.current;
    onClose?.({
      time: v?.currentTime ?? currentTime,
      muted: v?.muted ?? muted,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // Lock page scroll while the overlay is open, restore on close.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = initialTime;
    v.muted = initialMuted;
    v.play().catch(() => setPlaying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wakeControls = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) setShowControls(false);
    }, 2800);
  }, []);

  useEffect(() => {
    wakeControls();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [wakeControls]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
    wakeControls();
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    wakeControls();
  }

  function skip(delta) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + delta));
    setSkipFlash(delta < 0 ? "left" : "right");
    setTimeout(() => setSkipFlash(null), 500);
    wakeControls();
  }

  // Distinguishes a single tap (toggle play/pause) from a double tap (skip
  // ±5s) without depending on the browser's native dblclick event, which
  // doesn't fire reliably from touch taps on every mobile browser.
  function handleZoneTap(zone) {
    const now = Date.now();
    const last = tapRef.current;
    if (last.zone === zone && now - last.time < 320) {
      if (last.timer) clearTimeout(last.timer);
      tapRef.current = { time: 0, zone: null, timer: null };
      skip(zone === "left" ? -5 : 5);
      return;
    }
    if (last.timer) clearTimeout(last.timer);
    const timer = setTimeout(() => {
      togglePlay();
      tapRef.current = { time: 0, zone: null, timer: null };
    }, 320);
    tapRef.current = { time: now, zone, timer };
  }

  function handleSeekChange(e) {
    const v = videoRef.current;
    const value = Number(e.target.value);
    setCurrentTime(value);
    if (v) v.currentTime = value;
    wakeControls();
  }

  async function toggleNativeFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch {
      // fullscreen not supported/allowed — the overlay itself already
      // covers the full viewport, so this is a soft failure.
    }
  }

  useEffect(() => {
    function onFsChange() {
      setIsNativeFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") close();
      else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") skip(-5);
      else if (e.key === "ArrowRight") skip(5);
      else if (e.key.toLowerCase() === "m") toggleMute();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "#000" }}
      onMouseMove={wakeControls}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster || undefined}
        playsInline
        loop
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => {
          if (!seeking) setCurrentTime(e.currentTarget.currentTime);
        }}
        className="w-full h-full object-contain"
      />

      {/* Tap zones: left/right handle single-tap play/pause vs. double-tap
          skip; center is a plain toggle. */}
      <div className="absolute inset-0 flex">
        <div className="w-[35%] h-full" onClick={() => handleZoneTap("left")} />
        <div
          className="w-[30%] h-full"
          onClick={() => {
            togglePlay();
          }}
        />
        <div className="w-[35%] h-full" onClick={() => handleZoneTap("right")} />
      </div>

      {skipFlash && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 pointer-events-none ${
            skipFlash === "left" ? "left-[12%]" : "right-[12%]"
          }`}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.55)" }}
          >
            {skipFlash === "left" ? (
              <RotateCcw size={26} color="white" />
            ) : (
              <RotateCw size={26} color="white" />
            )}
          </div>
          <span className="text-xs font-semibold text-white drop-shadow">5s</span>
        </div>
      )}

      {!playing && (
        <button
          onClick={togglePlay}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full flex items-center justify-center pointer-events-none"
          style={{ background: "rgba(0,0,0,0.5)" }}
        >
          <Play size={28} color="white" fill="white" />
        </button>
      )}

      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between p-3 transition-opacity duration-200"
        style={{
          background: "linear-gradient(rgba(0,0,0,0.65), transparent)",
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls ? "auto" : "none",
        }}
      >
        <button
          onClick={close}
          className="p-2 rounded-full"
          style={{ background: "rgba(0,0,0,0.45)" }}
          aria-label="Close"
        >
          <X size={20} color="white" />
        </button>
        <button
          onClick={toggleNativeFullscreen}
          className="p-2 rounded-full"
          style={{ background: "rgba(0,0,0,0.45)" }}
          aria-label="Toggle fullscreen"
        >
          {isNativeFullscreen ? (
            <Minimize2 size={18} color="white" />
          ) : (
            <Maximize2 size={18} color="white" />
          )}
        </button>
      </div>

      {/* Bottom control bar */}
      <div
        className="absolute left-0 right-0 bottom-0 px-3 pb-3 pt-8 transition-opacity duration-200"
        style={{
          background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls ? "auto" : "none",
        }}
      >
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onMouseDown={() => setSeeking(true)}
          onTouchStart={() => setSeeking(true)}
          onMouseUp={() => setSeeking(false)}
          onTouchEnd={() => setSeeking(false)}
          onChange={handleSeekChange}
          className="w-full accent-[var(--accent)] cursor-pointer"
          style={{ accentColor: "var(--accent)" }}
        />
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-3">
            <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              {playing ? (
                <Pause size={20} color="white" fill="white" />
              ) : (
                <Play size={20} color="white" fill="white" />
              )}
            </button>
            <span className="text-xs font-mono text-white/80">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
          <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX size={20} color="white" /> : <Volume2 size={20} color="white" />}
          </button>
        </div>
      </div>
    </div>
  );
}
