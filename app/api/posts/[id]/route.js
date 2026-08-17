import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Post from "@/models/Post";
import { getCurrentUser } from "@/lib/auth";
import { deleteMediaFile, saveMediaFiles, MAX_IMAGE_COUNT } from "@/lib/upload";
import { serializePost } from "../route";
import { invalidateFeedCache } from "@/lib/getFeedPage";

// Public: anyone (including guests) can open a shared post link and view it.
export async function GET(req, { params }) {
  const { id } = await params;
  const viewer = await getCurrentUser();

  await connectDB();
  const post = await Post.findById(id)
    .populate("author", "username displayName avatar")
    .populate("comments.author", "username displayName avatar")
    .lean();
  if (!post) {
    return NextResponse.json({ error: "Post not found." }, { status: 404 });
  }

  return NextResponse.json({ post: serializePost(post, viewer?._id || null) });
}

export async function PATCH(req, { params }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { id } = await params;
  await connectDB();
  const post = await Post.findById(id);
  if (!post) {
    return NextResponse.json({ error: "Post not found." }, { status: 404 });
  }
  if (post.author.toString() !== user._id.toString()) {
    return NextResponse.json({ error: "You can only edit your own posts." }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const caption = form.get("caption")?.toString().slice(0, 2200);
    const hashtags = (form.get("hashtags") || "")
      .toString()
      .split(/,|\s+/)
      .map((tag) => tag.replace(/^#/, "").trim())
      .filter(Boolean);
    const location = form.get("location")?.toString().slice(0, 120);
    const keepMedia = JSON.parse(form.get("keepMedia") || "[]");
    const files = form.getAll("media").filter((file) => file && typeof file !== "string" && file.size > 0);

    const nextMediaItems = [...(Array.isArray(keepMedia) ? keepMedia : [])];
    if (files.length) {
      const uploaded = await saveMediaFiles(files);
      nextMediaItems.push(...uploaded.map((item) => ({ url: item.url, mediaType: item.mediaType, key: item.key })));
    }

    if (nextMediaItems.length === 0) {
      throw new Error("A post needs at least one photo or video.");
    }

    const hasVideo = nextMediaItems.some((item) => item.mediaType === "video");
    const hasImage = nextMediaItems.some((item) => item.mediaType === "image");
    if (hasVideo && hasImage) {
      throw new Error("Images and videos cannot be mixed in the same post.");
    }
    if (hasVideo && nextMediaItems.length > 1) {
      throw new Error("Only one video can be uploaded per post.");
    }
    if (hasImage && nextMediaItems.length > MAX_IMAGE_COUNT) {
      throw new Error(`You can upload up to ${MAX_IMAGE_COUNT} images in one post.`);
    }

    const removedItems = (post.mediaItems || []).filter((item) => !nextMediaItems.some((next) => next.url === item.url));
    for (const item of removedItems) {
      await deleteMediaFile(item);
    }

    post.caption = caption ?? post.caption;
    post.hashtags = hashtags.length ? hashtags : post.hashtags;
    post.location = location ?? post.location;
    post.mediaItems = nextMediaItems;
    post.mediaUrl = nextMediaItems[0].url;
    post.mediaType = nextMediaItems[0].mediaType;
    await post.save();

    const updated = await Post.findById(post._id).populate("author", "username displayName avatar").lean();
    return NextResponse.json({ post: serializePost(updated, user._id) });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Could not update your post." }, { status: 400 });
  }
}

export async function DELETE(req, { params }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { id } = await params;
  await connectDB();
  const post = await Post.findById(id);
  if (!post) {
    return NextResponse.json({ error: "Post not found." }, { status: 404 });
  }
  if (post.author.toString() !== user._id.toString()) {
    return NextResponse.json({ error: "You can only delete your own posts." }, { status: 403 });
  }

  for (const item of post.mediaItems || []) {
    await deleteMediaFile(item);
  }

  await Post.findByIdAndDelete(id);
  invalidateFeedCache();
  return NextResponse.json({ ok: true });
}
