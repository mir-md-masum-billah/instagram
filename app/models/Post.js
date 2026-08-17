import mongoose from "mongoose";

const CommentSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, maxlength: 500 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

const MediaItemSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    mediaType: { type: String, enum: ["image", "video"], required: true },
    key: String,
    fileName: String,
    size: Number,
  },
  { _id: false }
);

const PostSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    mediaUrl: { type: String, required: true },
    mediaType: { type: String, enum: ["image", "video"], required: true },
    mediaItems: [MediaItemSchema],
    caption: { type: String, maxlength: 2200, default: "" },
    thumbnail: { type: String, default: "" },
    hashtags: [{ type: String, trim: true }],
    location: { type: String, maxlength: 120, default: "" },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // Kept only to dedupe "has this signed-in user already viewed this
    // post" — never loaded in bulk (e.g. across a whole feed scan) since it
    // grows without bound for popular posts. Use viewCount for the number.
    views: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // Running total of unique signed-in views, kept in sync with views.length
    // via $inc in the view route. Lets the feed ranking read a single number
    // instead of loading the whole views array for every post on every scan.
    viewCount: { type: Number, default: 0 },
    anonymousViews: { type: Number, default: 0 },
    saves: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    shares: { type: Number, default: 0 },
    profileVisits: { type: Number, default: 0 },
    watchTimeMs: { type: Number, default: 0 },
    comments: [CommentSchema],
    exif: {
      aperture: String,
      iso: Number,
      shutter: String,
    },
  },
  { timestamps: true }
);

// mediaType: filtered on directly by the feed (?type=video/image) and by
// reels. createdAt: the feed's candidate scan sorts newest-first before
// ranking, and search sorts by it too. author+createdAt: profile pages list
// one author's posts newest-first.
PostSchema.index({ mediaType: 1, createdAt: -1 });
PostSchema.index({ createdAt: -1 });
PostSchema.index({ author: 1, createdAt: -1 });

export default mongoose.models.Post || mongoose.model("Post", PostSchema);
