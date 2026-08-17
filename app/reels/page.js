"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Clapperboard, Loader2 } from "lucide-react";
import ReelCard from "@/components/ReelCard";
import { notifyError } from "@/lib/toast";
import { getReelsSeed, reshuffleReelsSeed, watchedQueryParam, markReelWatched } from "@/lib/reelsSession";

function buildReelsQuery(page, seed) {
  const params = new URLSearchParams({ page: String(page), type: "video", mode: "reels", seed });
  const watched = watchedQueryParam();
  if (watched) params.set("watched", watched);
  return params.toString();
}

export default function ReelsPage() {
  const [reels, setReels] = useState(null);
  const [muted, setMuted] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageRef = useRef(1);
  const seedRef = useRef(getReelsSeed());
  const shownIdsRef = useRef(new Set());
  const sentinelRef = useRef(null);
  const loadingRef = useRef(false);

  // Pulls the next page of the current shuffle. When a pass through every
  // available reel finishes, it reshuffles into a fresh random order and
  // keeps going from page 1 again instead of stopping — so scrolling never
  // hits a hard end and never repeats the same sequence twice.
  const loadMore = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    const page = pageRef.current;

    fetch(`/api/posts?${buildReelsQuery(page, seedRef.current)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          notifyError(data.error);
          return;
        }
        const fresh = (data.posts || []).filter((p) => !shownIdsRef.current.has(p.id));
        fresh.forEach((p) => shownIdsRef.current.add(p.id));
        setReels((prev) => (prev ? [...prev, ...fresh] : fresh));

        if (data.hasMore) {
          pageRef.current = page + 1;
        } else {
          seedRef.current = reshuffleReelsSeed();
          pageRef.current = 1;
        }
      })
      .catch(() => notifyError("Could not load reels."))
      .finally(() => {
        loadingRef.current = false;
        setLoadingMore(false);
      });
  }, []);

  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || reels === null) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "1000px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reels, loadMore]);

  function handleDeleted(id) {
    setReels((rs) => rs.filter((r) => r.id !== id));
  }

  function handleWatched(id) {
    markReelWatched(id);
  }

  if (reels === null) {
    return (
      <p className="text-center text-sm mt-16" style={{ color: "var(--muted)" }}>
        Loading reels…
      </p>
    );
  }

  if (reels.length === 0) {
    return (
      <div className="text-center mt-20 flex flex-col items-center gap-3 px-4">
        <Clapperboard size={40} strokeWidth={1.3} style={{ color: "var(--accent)" }} />
        <p className="font-display text-2xl" style={{ color: "var(--text)" }}>
          No reels yet.
        </p>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Upload a video to kick things off.
        </p>
        <Link
          href="/upload"
          className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold"
          style={{ background: "var(--accent)", color: "#14120f" }}
        >
          <Plus size={16} /> Upload
        </Link>
      </div>
    );
  }

  return (
    <div
      className="w-full overflow-y-scroll snap-y snap-mandatory"
      style={{ height: "calc(100dvh - 4rem)" }}
    >
      {reels.map((post) => (
        <ReelCard
          key={post.id}
          post={post}
          onDeleted={handleDeleted}
          onWatched={handleWatched}
          muted={muted}
          onMuteChange={setMuted}
        />
      ))}
      <div ref={sentinelRef} style={{ height: 1 }} />
      {loadingMore && (
        <div
          className="snap-start w-full flex flex-col items-center justify-center gap-3"
          style={{ height: "40dvh", background: "#000" }}
        >
          <Loader2 size={32} className="animate-spin" style={{ color: "var(--accent)" }} />
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Loading more reels…
          </p>
        </div>
      )}
    </div>
  );
}
