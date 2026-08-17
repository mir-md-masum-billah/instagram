import { connectDB } from "@/lib/db";
import Post from "@/models/Post";
import { rankPosts, rankReels } from "@/lib/ranking";
import { serializePost } from "@/lib/serializePost";

const PAGE_LIMIT = 12;

// The ranking pass needs every post's lightweight engagement fields to score
// and sort them, so this can't be paginated at the DB level — but re-running
// that full collection fetch on every single feed/page-2/reels request (and
// for every concurrent viewer) is the main reason the feed got slow as the
// post count grew. Cache the raw rows for a few seconds so bursts of
// requests share one DB round trip; ranking (which is per-viewer via
// seed/interest/seen-ids) still runs fresh every call.
const LIGHT_POSTS_TTL_MS = 15_000;
let lightPostsCache = global._lightPostsCache;
if (!lightPostsCache) {
  lightPostsCache = global._lightPostsCache = new Map(); // key: query type -> { data, expiresAt }
}

// Call after creating/deleting a post so the next feed request doesn't wait
// out the TTL to include it.
export function invalidateFeedCache() {
  lightPostsCache.clear();
}

async function getLightPosts(query, cacheKey) {
  const cached = lightPostsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Ranking only ever needs COUNTS (how many likes/views/comments/saves a
  // post has), never the actual arrays of ids — but the previous query
  // pulled the full arrays over the wire for every post. On posts with a
  // lot of engagement (thousands of likes/views/comments), that array data
  // is what was actually making this query take 40-50s: MongoDB was
  // shipping megabytes of ObjectIds/comment subdocuments across the network
  // just so we could call .length on them. Computing the counts in the
  // aggregation pipeline means only small numbers cross the wire instead.
  const data = await Post.aggregate([
    { $match: query },
    {
      $project: {
        createdAt: 1,
        author: 1,
        hashtags: 1,
        likeCount: { $size: { $ifNull: ["$likes", []] } },
        commentCount: { $size: { $ifNull: ["$comments", []] } },
        viewCount: { $size: { $ifNull: ["$views", []] } },
        anonymousViews: 1,
        saveCount: { $size: { $ifNull: ["$saves", []] } },
        shares: 1,
        profileVisits: 1,
        watchTimeMs: 1,
      },
    },
  ]);

  lightPostsCache.set(cacheKey, { data, expiresAt: Date.now() + LIGHT_POSTS_TTL_MS });
  return data;
}

/**
 * Shared feed-paging logic, used by both /api/posts (client-side pagination
 * for page 2+) and the server-rendered homepage (page 1, so real content is
 * present in the initial HTML instead of behind a client-side fetch).
 *
 * Keeping this in one place means the two call sites can never drift apart
 * in ranking/pagination behavior.
 */
export async function getFeedPage({
  page = 1,
  type,
  mode,
  seed,
  seenFreshIds = [],
  skippedIds = [],
  interestTags = [],
  interestAuthors = [],
  watchedRecently = new Map(),
  userId = null,
} = {}) {
  const t0 = Date.now();
  await connectDB();
  const t1 = Date.now();

  const query = type === "video" || type === "image" ? { mediaType: type } : {};
  const cacheKey = type === "video" || type === "image" ? type : "all";

  const lightPosts = await getLightPosts(query, cacheKey);
  const t2 = Date.now();

  const ranked =
    mode === "reels"
      ? rankReels(lightPosts, { seed, watchedRecently })
      : rankPosts(lightPosts, { seed, seenFreshIds, skippedIds, interestTags, interestAuthors });

  const start = (page - 1) * PAGE_LIMIT;
  const pageSlice = ranked.slice(start, start + PAGE_LIMIT);
  const freshById = new Map(pageSlice.map((p) => [p._id.toString(), Boolean(p.__isFresh)]));
  const pageIds = pageSlice.map((p) => p._id);

  const fullPosts = await Post.find({ _id: { $in: pageIds } })
    .populate("author", "username displayName avatar")
    .populate("comments.author", "username displayName avatar")
    .lean();
  const t3 = Date.now();

  console.log(
    `[feed timing] connectDB: ${t1 - t0}ms | lightPosts(${lightPosts.length} docs, cache=${
      t2 - t1 < 5 ? "hit" : "miss"
    }): ${t2 - t1}ms | fullPosts(${pageIds.length} docs): ${t3 - t2}ms | total: ${t3 - t0}ms`
  );

  const fullById = new Map(fullPosts.map((p) => [p._id.toString(), p]));

  const pageItems = pageIds
    .map((id) => fullById.get(id.toString()))
    .filter(Boolean)
    .map((p) => Object.assign(p, { __isFresh: freshById.get(p._id.toString()) }));

  const serialized = pageItems.map((p) => serializePost(p, userId));

  return {
    posts: serialized,
    page,
    hasMore: start + PAGE_LIMIT < ranked.length,
    totalCount: ranked.length,
  };
}
