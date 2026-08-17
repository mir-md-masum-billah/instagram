function seededRandom(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  const x = Math.sin(hash) * 10000;
  return x - Math.floor(x);
}

// A post counts as "fresh" (eligible for its one free trip to the top of
// the feed) for this long after it's posted.
const FRESH_WINDOW_HOURS = 6;

export function isFreshPost(post) {
  const ageHours = (Date.now() - new Date(post.createdAt).getTime()) / 36e5;
  return ageHours >= 0 && ageHours < FRESH_WINDOW_HOURS;
}

/**
 * Ranks posts for a feed.
 *
 * options:
 *  - seed: per-viewer-session string. Randomizing per session (instead of
 *    per calendar day) means the same post doesn't camp at the top of
 *    everyone's feed all day, while staying stable while one session scrolls.
 *  - seenFreshIds: ids of posts this viewer already had shown to them once
 *    while fresh — their one-time "new post" boost is retired so they settle
 *    into the feed based on normal engagement instead of staying pinned up top.
 *  - skippedIds: ids of posts the viewer scrolled straight past without
 *    liking/commenting/opening — nudged down so the same ignored post
 *    doesn't keep resurfacing in the same spot.
 *  - interestTags / interestAuthors: hashtags/authors this viewer tends to
 *    engage with, used to lean the ranking toward similar posts.
 */
export function rankPosts(posts, options = {}) {
  const {
    seed = new Date().toISOString().slice(0, 10),
    seenFreshIds = [],
    skippedIds = [],
    interestTags = [],
    interestAuthors = [],
  } = options;

  const seenFresh = new Set(seenFreshIds);
  const skipped = new Set(skippedIds);
  const tagInterest = new Set(interestTags.map((t) => t.toLowerCase()));
  const authorInterest = new Set(interestAuthors);

  return posts
    .map((p) => {
      const id = p._id.toString();
      const ageHours = Math.max(0, (Date.now() - new Date(p.createdAt).getTime()) / 36e5);
      // These come pre-counted from getFeedPage's aggregation ($size on the
      // underlying arrays), not the raw likes/comments/views/saves arrays
      // themselves — ranking only ever needed the counts.
      const likes = p.likeCount || 0;
      const comments = p.commentCount || 0;
      const views = (p.viewCount || 0) + (p.anonymousViews || 0);
      const saves = p.saveCount || 0;
      const shares = p.shareCount || 0;
      const profileVisits = p.profileVisitCount || 0;
      const watchTimeMinutes = (p.watchTimeMs || 0) / 60000;

      const recentActivity = likes + comments + saves + shares;
      const engagementRatio = (recentActivity / Math.max(1, views + 1)) * 100;

      const weightedEngagement =
        views * 1.2 +
        watchTimeMinutes * 0.7 +
        likes * 4.5 +
        comments * 6 +
        saves * 8 +
        shares * 10 +
        profileVisits * 1.8 +
        engagementRatio * 2.4 +
        recentActivity * 3;

      const engagementScore = Math.log10(weightedEngagement + 1) * 34;

      // Fresh posts get a strong boost exactly once per viewer — after that
      // first appearance the boost is retired and the post has to earn its
      // place from engagement like everything else, which is what pushes it
      // further down the feed on later visits/scrolls.
      const stillFreshForViewer = isFreshPost(p) && !seenFresh.has(id);
      const freshnessBoost = stillFreshForViewer ? 90 / Math.pow(ageHours / 10 + 1, 1.2) : 0;
      const recencyBoost = stillFreshForViewer
        ? ageHours < 24
          ? 16
          : Math.max(0, 20 - ageHours / 6)
        : Math.max(0, 6 - ageHours / 12);

      // A post the viewer already scrolled past without engaging is treated
      // as "not interesting to them right now" and pushed well down, rather
      // than being shown at the top of the feed again and again.
      const skipPenalty = skipped.has(id) ? 55 : 0;

      // Nudge toward hashtags/authors this viewer tends to engage with.
      const tagMatches = (p.hashtags || []).filter((t) => tagInterest.has((t || "").toLowerCase())).length;
      const authorMatch = authorInterest.has(p.author?._id?.toString() || p.author?.toString());
      const interestBoost = tagMatches * 9 + (authorMatch ? 14 : 0);

      // Reshuffled every session (not frozen for the whole day) so the same
      // post isn't glued to the top forever, while still spreading enough
      // (7 points) to meaningfully break ties between similarly-scored posts.
      const jitter = seededRandom(id + seed) * 7;

      const score =
        engagementScore + freshnessBoost + recencyBoost + interestBoost + jitter - skipPenalty;

      return { post: p, score, isFresh: stillFreshForViewer };
    })
    .sort((a, b) => b.score - a.score)
    .map((s) => Object.assign(s.post, { __isFresh: s.isFresh }));
}

// How long a reel stays "cooling down" after being watched before it's
// fully eligible to be shown again. The penalty fades out linearly over
// this window rather than cutting off sharply, so a reel doesn't pop back
// in the instant the cooldown ends.
const REEL_COOLDOWN_MS = 20 * 60 * 1000;

/**
 * Ranks posts for the Reels feed.
 *
 * Deliberately much simpler than rankPosts: no engagement, freshness, or
 * interest weighting at all — every pass is a fresh uniform-random shuffle,
 * so there's no fixed order to "settle into" and refreshing never reproduces
 * the same sequence. The only non-random factor is a temporary cooldown on
 * reels the viewer already watched, so the same clip doesn't resurface
 * immediately — it comes back into full random rotation once the cooldown
 * fades.
 *
 * options:
 *  - seed: a fresh string per pass (new on every page load, and again each
 *    time the client completes a full pass and reshuffles).
 *  - watchedRecently: Map of postId -> timestamp (ms) of when the viewer
 *    last watched it.
 */
export function rankReels(posts, options = {}) {
  const { seed = randomSeedFallback(), watchedRecently = new Map() } = options;

  return posts
    .map((p) => {
      const id = p._id.toString();
      const randomScore = seededRandom(id + seed) * 100;
      const watchedAt = watchedRecently.get(id);
      const msSince = watchedAt ? Date.now() - watchedAt : Infinity;
      const cooldownFraction = Math.max(0, 1 - msSince / REEL_COOLDOWN_MS);
      const recentWatchPenalty = cooldownFraction * 500;
      return { post: p, score: randomScore - recentWatchPenalty };
    })
    .sort((a, b) => b.score - a.score)
    .map((s) => s.post);
}

function randomSeedFallback() {
  return Math.random().toString(36) + Date.now().toString(36);
}
