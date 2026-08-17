import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Post from "@/models/Post";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req, { params }) {
  const user = await getCurrentUser();

  const { id } = await params;
  await connectDB();

  // Atomic updates instead of find → mutate → save: the old version read
  // the whole document (including the full views array, just to count and
  // re-save it) and could double-count under two concurrent requests from
  // the same viewer, since the read and the write weren't a single
  // operation. These $inc/$push updates are each one atomic DB op and never
  // pull the views array into app memory.
  if (!user) {
    const post = await Post.findByIdAndUpdate(
      id,
      { $inc: { anonymousViews: 1 } },
      { new: true }
    ).select("viewCount anonymousViews");
    if (!post) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }
    return NextResponse.json({ viewCount: (post.viewCount || 0) + post.anonymousViews });
  }

  // $ne guard makes the push+increment conditional on this user not
  // already being in views — so a duplicate/racing request from the same
  // viewer is a no-op instead of double-counting.
  const updated = await Post.findOneAndUpdate(
    { _id: id, views: { $ne: user._id } },
    { $push: { views: user._id }, $inc: { viewCount: 1 } },
    { new: true }
  ).select("viewCount anonymousViews");

  if (updated) {
    return NextResponse.json({ viewCount: updated.viewCount + (updated.anonymousViews || 0) });
  }

  // No document matched either because the post doesn't exist, or because
  // this viewer already had a view recorded — tell those two cases apart.
  const existing = await Post.findById(id).select("viewCount anonymousViews");
  if (!existing) {
    return NextResponse.json({ error: "Post not found." }, { status: 404 });
  }
  return NextResponse.json({ viewCount: (existing.viewCount || 0) + (existing.anonymousViews || 0) });
}
