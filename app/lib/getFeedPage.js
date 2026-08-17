import { connectDB } from "@/lib/db";
import Post from "@/models/Post";
import { rankPosts, rankReels } from "@/lib/ranking";
import { serializePost } from "@/lib/serializePost";

const PAGE_LIMIT = 12;

// Ranking (freshness/engagement/interest scoring) runs in JS over whatever
// this query returns, then slices out one page — so its cost was scaling
// with the TOTAL number of posts ever created, not with what's actually
// shown. Bounding the candidate set to the most recent N posts keeps that
// cost flat as the collection grows, while still covering far more than
// anyone pages through (old posts have long since sunk on engagement/
// recency anyway, so this doesn't change what a viewer sees in practice).
// The mediaType+createdAt index on Post backs this query directly.
const RANKING_CANDIDATE_LIMIT = 2000;

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
  await connectDB();

  const match = type === "video" || type === "image" ? { mediaType: type } : {};

  // Ranking only needs COUNTS (likes/comments/views/saves) plus a few small
  // scalar fields — not the full likes/views/comments arrays, which can
  // grow to thousands of entries per post. $size computes each count in
  // MongoDB and only that number crosses the wire, instead of every
  // engaged user's ObjectId for every post on every feed request.
  const lightPosts = await Post.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $limit: RANKING_CANDIDATE_LIMIT },
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
        shareCount: "$shares",
        profileVisitCount: "$profileVisits",
        watchTimeMs: 1,
      },
    },
  ]);

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
