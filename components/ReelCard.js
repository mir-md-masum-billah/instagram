"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Heart, MessageCircle, Volume2, VolumeX, Send, Trash2, Pencil, X, Check, Share2, Maximize2 } from "lucide-react";
import { useCurrentUser } from "@/components/UserContext";
import { notifyError, notifySuccess, confirmToast } from "@/lib/toast";
import { hasViewedLocally, markViewedLocally } from "@/lib/viewedPosts";
import VideoFullscreenPlayer from "@/components/VideoFullscreenPlayer";

export default function ReelCard({ post, onDeleted, muted, onMuteChange, onWatched }) {
  const currentUser = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hasViewed = useRef(false);

  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [comments, setComments] = useState(post.comments || []);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editText, setEditText] = useState("");
  const [speedLevel, setSpeedLevel] = useState(0); // 0 = normal (1x), 1 = 2x forward, -1 = rewinding
  const [showFullscreen, setShowFullscreen] = useState(false);

  const SPEEDS = [1, 2];
  const holdTimerRef = useRef(null);
  const isHoldingRef = useRef(false);
  const startXRef = useRef(0);
  const pointerIdRef = useRef(null);
  const rewindActiveRef = useRef(false);
  const rewindRateRef = useRef(1);
  const rafIdRef = useRef(null);
  const lastFrameTimeRef = useRef(0);

  const isMyPost = currentUser && post.author?.id === currentUser.id;

  function requireAuth() {
    if (!currentUser) {
      router.push(`/login?next=${encodeURIComponent(pathname || "/reels")}`);
      return false;
    }
    return true;
  }

  async function sharePost() {
    const url = `${window.location.origin}/p/${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: post.caption || "Check this out on LeakReels", url });
      } else {
        await navigator.clipboard.writeText(url);
        notifySuccess("Link copied to clipboard.");
      }
    } catch {
      // user closed the native share sheet
    }
    fetch(`/api/posts/${post.id}/share`, { method: "POST" }).catch(() => { });
  }

  // Press-and-hold gesture:
  //  - hold (no drag): plays forward at 2x
  //  - drag right while holding: eases back down to normal (1x) forward speed
  //  - drag left past a threshold while holding: actually scrubs the video
  //    backward (real rewind, not just a slower/faster forward speed) —
  //    the further left, the faster the rewind
  //  - release: resumes normal forward playback at 1x from wherever it landed
  //  - a quick tap with no hold/drag still just toggles mute
  const STEP_PX = 50;
  const REWIND_THRESHOLD_PX = 70;
  const MAX_REWIND_RATE = 4;

  function clearHoldTimer() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function stepRewind(now) {
    const video = videoRef.current;
    if (!video || !rewindActiveRef.current) {
      rafIdRef.current = null;
      return;
    }
    const dt = (now - lastFrameTimeRef.current) / 1000;
    lastFrameTimeRef.current = now;
    video.currentTime = Math.max(0, video.currentTime - rewindRateRef.current * dt);
    rafIdRef.current = requestAnimationFrame(stepRewind);
  }

  function startRewind() {
    if (rewindActiveRef.current) return;
    rewindActiveRef.current = true;
    const video = videoRef.current;
    if (video) video.pause();
    lastFrameTimeRef.current = performance.now();
    rafIdRef.current = requestAnimationFrame(stepRewind);
  }

  function stopRewind({ resume } = { resume: false }) {
    rewindActiveRef.current = false;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (resume) {
      const video = videoRef.current;
      if (video) video.play().catch(() => {});
    }
  }

  function handlePointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerIdRef.current = e.pointerId;
    startXRef.current = e.clientX;
    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => {
      isHoldingRef.current = true;
      setSpeedLevel(1);
      const video = videoRef.current;
      if (video) video.playbackRate = SPEEDS[1];
    }, 250);
  }

  function handlePointerMove(e) {
    if (!isHoldingRef.current || pointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    const deltaX = e.clientX - startXRef.current;

    if (deltaX <= -REWIND_THRESHOLD_PX) {
      startRewind();
      const overshoot = Math.abs(deltaX) - REWIND_THRESHOLD_PX;
      rewindRateRef.current = Math.min(MAX_REWIND_RATE, 1 + overshoot / 60);
      setSpeedLevel(-1);
      return;
    }

    if (rewindActiveRef.current) {
      stopRewind({ resume: true });
    }

    const level = Math.max(0, Math.min(1, 1 - Math.round(deltaX / STEP_PX)));
    setSpeedLevel(level);
    const video = videoRef.current;
    if (video) video.playbackRate = SPEEDS[level];
  }

  function endHold(e) {
    if (pointerIdRef.current !== null && e && e.pointerId !== pointerIdRef.current) return;
    clearHoldTimer();
    const wasHolding = isHoldingRef.current;
    const wasRewinding = rewindActiveRef.current;
    isHoldingRef.current = false;
    pointerIdRef.current = null;
    stopRewind({ resume: wasRewinding });
    const video = videoRef.current;
    if (wasHolding) {
      if (video) video.playbackRate = 1;
      setSpeedLevel(0);
    } else {
      onMuteChange(!muted);
    }
  }

  useEffect(() => {
    return () => {
      clearHoldTimer();
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const el = containerRef.current;
    if (!video || !el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          video.play().catch(() => {});
          if (!hasViewed.current && !hasViewedLocally(post.id)) {
            hasViewed.current = true;
            markViewedLocally(post.id);
            fetch(`/api/posts/${post.id}/view`, { method: "POST" }).catch(() => {});
          }
          onWatched?.(post.id);
        } else {
          video.pause();
        }
      },
      { threshold: [0, 0.6, 1] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [post.id]);

  async function toggleLike() {
    if (!requireAuth()) return;
    setLiked((v) => !v);
    setLikeCount((c) => (liked ? c - 1 : c + 1));
    try {
      const res = await fetch(`/api/posts/${post.id}/like`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setLiked(data.liked);
        setLikeCount(data.likeCount);
      }
    } catch {
      setLiked((v) => !v);
      notifyError("Couldn't update your like.");
    }
  }

  async function submitComment(e) {
    e.preventDefault();
    if (!requireAuth()) return;
    if (!commentText.trim()) return;
    try {
      const res = await fetch(`/api/posts/${post.id}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: commentText }),
      });
      const data = await res.json();
      if (res.ok) {
        setComments((c) => [...c, { ...data.comment, likeCount: 0, likedByMe: false }]);
        setCommentText("");
      } else {
        notifyError(data.error);
      }
    } catch {
      notifyError("Couldn't post your comment.");
    }
  }

  async function toggleCommentLike(comment) {
    if (!requireAuth()) return;
    setComments((cs) =>
      cs.map((c) =>
        c.id === comment.id
          ? { ...c, likedByMe: !c.likedByMe, likeCount: c.likedByMe ? c.likeCount - 1 : c.likeCount + 1 }
          : c
      )
    );
    try {
      const res = await fetch(`/api/posts/${post.id}/comment/${comment.id}/like`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setComments((cs) =>
          cs.map((c) => (c.id === comment.id ? { ...c, likedByMe: data.liked, likeCount: data.likeCount } : c))
        );
      }
    } catch {
      // keep optimistic state
    }
  }

  async function saveEditComment(comment) {
    if (!editText.trim()) return;
    try {
      const res = await fetch(`/api/posts/${post.id}/comment/${comment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editText }),
      });
      const data = await res.json();
      if (res.ok) {
        setComments((cs) => cs.map((c) => (c.id === comment.id ? { ...c, text: data.comment.text, edited: true } : c)));
        setEditingCommentId(null);
      } else {
        notifyError(data.error);
      }
    } catch {
      notifyError("Couldn't save your edit.");
    }
  }

  async function deleteComment(comment) {
    setComments((cs) => cs.filter((c) => c.id !== comment.id));
    try {
      await fetch(`/api/posts/${post.id}/comment/${comment.id}`, { method: "DELETE" });
    } catch {
      // best effort
    }
  }

  return (
    <div
      ref={containerRef}
      className="snap-start shrink-0 w-full h-full relative flex items-center justify-center"
      style={{ background: "#000", scrollSnapStop: "always" }}
    >
      <video
        ref={videoRef}
        src={post.mediaUrl}
        poster={post.thumbnailUrl || undefined}
        preload="metadata"
        loop
        muted={muted}
        playsInline
        draggable={false}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endHold}
        onPointerCancel={endHold}
        onPointerLeave={endHold}
        onContextMenu={(e) => e.preventDefault()}
        style={{ touchAction: "pan-y", WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
        className="w-full h-full object-contain cursor-pointer"
      />

      {speedLevel !== 0 && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-3 py-1.5 rounded-full text-sm font-semibold text-white pointer-events-none flex items-center gap-1.5"
          style={{ background: "rgba(0,0,0,0.55)" }}
        >
          {speedLevel === -1 ? (
            <>⏪ Rewinding</>
          ) : (
            <>{SPEEDS[speedLevel]}x speed</>
          )}
        </div>
      )}

      <button
        onClick={() => onMuteChange(!muted)}
        className="absolute top-4 right-4 p-2 rounded-full"
        style={{ background: "rgba(0,0,0,0.45)" }}
      >
        {muted ? <VolumeX size={18} color="white" /> : <Volume2 size={18} color="white" />}
      </button>

      {/* This reel's own gestures (hold-to-speed-up, drag-to-rewind) have no
          visible timeline — this opens the same YouTube-style viewer used
          elsewhere in the app, with a real seek bar. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          const video = videoRef.current;
          if (video) video.pause();
          setShowFullscreen(true);
        }}
        className="absolute top-4 right-16 p-2 rounded-full"
        style={{ background: "rgba(0,0,0,0.45)" }}
        aria-label="View fullscreen with timeline"
      >
        <Maximize2 size={18} color="white" />
      </button>

      {showFullscreen && (
        <VideoFullscreenPlayer
          src={post.mediaUrl}
          poster={post.thumbnailUrl}
          initialTime={videoRef.current?.currentTime || 0}
          initialMuted={muted}
          onClose={({ time, muted: finalMuted }) => {
            setShowFullscreen(false);
            const video = videoRef.current;
            if (video) {
              video.currentTime = time;
              video.play().catch(() => {});
            }
            if (finalMuted !== muted) onMuteChange(finalMuted);
          }}
        />
      )}

      {/* Right action column */}
      <div
        className="absolute right-3 flex flex-col items-center gap-5"
        style={{ bottom: "calc(6rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <button onClick={toggleLike} className="flex flex-col items-center gap-1">
          <Heart
            size={30}
            strokeWidth={1.75}
            fill={liked ? "var(--accent)" : "rgba(255,255,255,0.15)"}
            style={{ color: liked ? "var(--accent)" : "white" }}
          />
          <span className="text-xs font-medium text-white drop-shadow">{likeCount}</span>
        </button>
        <button onClick={() => setShowComments(true)} className="flex flex-col items-center gap-1">
          <MessageCircle size={28} strokeWidth={1.75} color="white" />
          <span className="text-xs font-medium text-white drop-shadow">{comments.length}</span>
        </button>
        <button onClick={sharePost} className="flex flex-col items-center gap-1">
          <Share2 size={26} strokeWidth={1.75} color="white" />
        </button>
        {isMyPost && (
          <button
            onClick={() =>
              confirmToast("Delete this reel?", async () => {
                const res = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
                if (res.ok) onDeleted?.(post.id);
              })
            }
            className="flex flex-col items-center gap-1"
          >
            <Trash2 size={24} strokeWidth={1.75} color="white" />
          </button>
        )}
      </div>

      {/* Bottom author + caption overlay */}
      <div
        className="absolute left-0 right-16 bottom-0 p-4 w-[97.5vw]"
        style={{
          background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
          paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <Link href={`/profile/${post.author?.username}`} className="flex items-center gap-2 mb-1.5 min-w-0">
          <div
            className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center font-display text-sm shrink-0"
            style={{ background: "var(--surface-2)", color: "var(--gold)" }}
          >
            {post.author?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.author.avatar} alt={post.author?.username || ""} className="w-full h-full object-cover" />
            ) : (
              post.author?.displayName?.[0]?.toUpperCase() || "?"
            )}
          </div>
          <span className="text-sm font-semibold text-white truncate">{post.author?.username}</span>
        </Link>
        {post.caption && <p className="text-sm text-white/90">{post.caption}</p>}
      </div>

      {/* Comments drawer */}
      {showComments && (
        <div
          className="absolute inset-0 flex flex-col justify-end"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setShowComments(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-t-2xl p-4 max-h-[70%] flex flex-col gap-3 overflow-y-auto"
            style={{ background: "var(--surface)" }}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg" style={{ color: "var(--text)" }}>
                Comments
              </h3>
              <button onClick={() => setShowComments(false)} style={{ color: "var(--muted)" }}>
                <X size={20} />
              </button>
            </div>

            {comments.length === 0 && (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                No comments yet — say something.
              </p>
            )}

            {comments.map((c) => {
              const isCommentAuthor = currentUser && c.author?.id === currentUser.id;
              const canDelete = isCommentAuthor || isMyPost;
              const isEditing = editingCommentId === c.id;
              return (
                <div key={c.id} className="text-sm" style={{ color: "var(--text)" }}>
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="flex-1 px-2.5 py-1 rounded-full text-sm outline-none border"
                        style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
                        autoFocus
                      />
                      <button onClick={() => saveEditComment(c)} style={{ color: "var(--gold)" }}>
                        <Check size={16} />
                      </button>
                      <button onClick={() => setEditingCommentId(null)} style={{ color: "var(--muted)" }}>
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <Link href={`/profile/${c.author?.username}`} className="shrink-0">
                          <div
                            className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center font-display text-[11px]"
                            style={{ background: "var(--surface-2)", color: "var(--gold)" }}
                          >
                            {c.author?.avatar ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={c.author.avatar} alt={c.author?.username || ""} className="w-full h-full object-cover" />
                            ) : (
                              c.author?.displayName?.[0]?.toUpperCase() || c.author?.username?.[0]?.toUpperCase() || "?"
                            )}
                          </div>
                        </Link>
                        <p className="flex-1 min-w-0">
                          <Link href={`/profile/${c.author?.username}`} className="font-medium">
                            {c.author?.username}
                          </Link>{" "}
                          <span style={{ color: "var(--muted)" }}>{c.text}</span>
                          {c.edited && (
                            <span className="font-mono text-[10px] ml-1" style={{ color: "var(--muted)" }}>
                              (edited)
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => toggleCommentLike(c)} className="flex items-center gap-1">
                          <Heart
                            size={13}
                            fill={c.likedByMe ? "var(--accent)" : "none"}
                            style={{ color: c.likedByMe ? "var(--accent)" : "var(--muted)" }}
                          />
                          {c.likeCount > 0 && (
                            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                              {c.likeCount}
                            </span>
                          )}
                        </button>
                        {isCommentAuthor && (
                          <button
                            onClick={() => {
                              setEditingCommentId(c.id);
                              setEditText(c.text);
                            }}
                            style={{ color: "var(--muted)" }}
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => deleteComment(c)} style={{ color: "var(--muted)" }}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <form onSubmit={submitComment} className="flex items-center gap-2 mt-1 sticky bottom-0">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment…"
                className="flex-1 px-3 py-1.5 rounded-full text-sm outline-none border"
                style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
              />
              <button type="submit" disabled={!commentText.trim()} style={{ color: "var(--accent)" }} className="disabled:opacity-40">
                <Send size={18} strokeWidth={1.75} />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}