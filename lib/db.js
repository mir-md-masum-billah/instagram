import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

let cached = global._mongooseCache;
if (!cached) {
  cached = global._mongooseCache = { conn: null, promise: null };
}

export async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI is not set. Add it to .env.local (see .env.local.example)."
    );
  }

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI, {
        bufferCommands: false,
        // Fail fast (instead of hanging) if the app genuinely can't reach the
        // cluster — makes a network/firewall/IP-allowlist problem show up as
        // a clear error in a few seconds instead of a mysterious long wait.
        serverSelectionTimeoutMS: 8000,
      })
      .then((m) => m);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
