import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Post from "@/models/Post";
import { getCurrentUser } from "@/lib/auth";
import { saveMediaFiles, MAX_IMAGE_COUNT } from "@/lib/upload";
import { generateExif } from "@/lib/exif";
import { getFeedPage, invalidateFeedCache } from "@/lib/getFeedPage";
import { serializePost } from "@/lib/serializePost";

// Re-exported for backward compatibility — other routes/pages still import
// serializePost from here. The real implementation lives in
// lib/serializePost.js so lib/getFeedPage.js can use it too without an
// import cycle (getFeedPage.js <-> this file).
export { serializePost };

export async function GET(req) {
  // Guests can browse the feed and reels read-only (like Instagram); actions
  // such as liking, commenting, or following still require signing in and are
  // enforced by their own routes.
  const user = await getCurrentUser();

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const type = searchParams.get("type");
  const mode = searchParams.get("mode");

  // Feed-personalization signals sent by the client (see lib/feedSession.js
  // and lib/interest.js) — all optional, all comma-separated id/tag lists.
  const parseList = (key, max) =>
    (searchParams.get(key) || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, max);
  const seed = (searchParams.get("seed") || "").slice(0, 64) || undefined;
  const seenFreshIds = parseList("seenFresh", 400);
  const skippedIds = parseList("skipped", 400);
  const interestTags = parseList("interestTags", 20);
  const interestAuthors = parseList("interestAuthors", 20);

  // Reels sends "id:timestamp" pairs (see lib/reelsSession.js) of clips this
  // viewer already watched, so the reels ranking can cool them down instead
  // of resurfacing them right away.
  const watchedRecently = new Map(
    (searchParams.get("watched") || "")
      .split(",")
      .map((pair) => pair.split(":"))
      .filter(([id, ts]) => id && ts && Number.isFinite(Number(ts)))
      .slice(0, 500)
      .map(([id, ts]) => [id, Number(ts)])
  );

  const { posts, hasMore, totalCount } = await getFeedPage({
    page,
    type,
    mode,
    seed,
    seenFreshIds,
    skippedIds,
    interestTags,
    interestAuthors,
    watchedRecently,
    userId: user?._id || null,
  });

  return NextResponse.json({
    posts,
    page,
    hasMore,
    totalCount,
    viewerSignedIn: Boolean(user),
  });
}

export async function POST(req) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let mediaItems, caption, hashtags, location, thumbnailUrl;

    if (contentType.includes("application/json")) {
      // Videos are uploaded directly to R2 from the browser via a presigned
      // URL (see /api/uploads/video-presign) to stay under Vercel's 4.5MB
      // function body limit. This branch just records the resulting media.
      const body = await req.json();
      caption = (body.caption || "").toString().slice(0, 2200);
      hashtags = (body.hashtags || "")
        .toString()
        .split(/,|\s+/)
        .map((tag) => tag.replace(/^#/, "").trim())
        .filter(Boolean);
      location = (body.location || "").toString().slice(0, 120);
      thumbnailUrl = (body.thumbnailUrl || "").toString().slice(0, 500);

      const items = Array.isArray(body.mediaItems) ? body.mediaItems : [];
      if (items.length === 0) {
        throw new Error("Choose at least one photo or video.");
      }
      if (items.length > 1) {
        throw new Error("Only one video can be uploaded per post.");
      }
      mediaItems = items.map((item) => {
        if (!item?.url || !item?.key || item.mediaType !== "video") {
          throw new Error("Invalid media item.");
        }
        return { url: item.url, mediaType: "video", key: item.key };
      });
    } else {
      const form = await req.formData();
      const files = form.getAll("media").filter((file) => file && typeof file !== "string" && file.size > 0);
      caption = (form.get("caption") || "").toString().slice(0, 2200);
      hashtags = (form.get("hashtags") || "")
        .toString()
        .split(/,|\s+/)
        .map((tag) => tag.replace(/^#/, "").trim())
        .filter(Boolean);
      location = (form.get("location") || "").toString().slice(0, 120);

      if (files.length === 0) {
        throw new Error("Choose at least one photo or video.");
      }

      const isVideo = files.some((file) => file.type.startsWith("video"));
      const isImage = files.some((file) => file.type.startsWith("image"));

      if (isVideo && isImage) {
        throw new Error("Images and videos cannot be mixed in the same post.");
      }
      if (isVideo && files.length > 1) {
        throw new Error("Only one video can be uploaded per post.");
      }
      if (isImage && files.length > MAX_IMAGE_COUNT) {
        throw new Error(`You can upload up to ${MAX_IMAGE_COUNT} images in one post.`);
      }

      mediaItems = await saveMediaFiles(files);
    }

    const primaryMedia = mediaItems[0];

    await connectDB();
    const post = await Post.create({
      author: user._id,
      mediaUrl: primaryMedia.url,
      mediaType: primaryMedia.mediaType,
      mediaItems: mediaItems.map((item) => ({
        url: item.url,
        mediaType: item.mediaType,
        key: item.key,
      })),
      caption,
      hashtags,
      location,
      thumbnail: thumbnailUrl || "",
      exif: generateExif(),
    });

    const populated = await Post.findById(post._id)
      .populate("author", "username displayName avatar")
      .lean();

    invalidateFeedCache();

    return NextResponse.json({ post: serializePost(populated, user._id) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Could not create post." },
      { status: 400 }
    );
  }
}

