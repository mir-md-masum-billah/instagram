/* eslint-disable no-console */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const MONGODB_URI = process.env.MONGODB_URI;
const USERNAME = (process.env.SEED_ADMIN_USERNAME || "admin").toLowerCase();
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "moderator", "user"], default: "user" },
    status: { type: String, enum: ["active", "suspended", "banned"], default: "active" },
  },
  { timestamps: true }
);

const WalletSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    availableBalance: { type: Number, default: 0 },
    pendingBalance: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 },
    withdrawnAmount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

async function main() {
  if (!MONGODB_URI) {
    console.error("MONGODB_URI is not set. Add it to your .env file first.");
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);

  const User = mongoose.models.User || mongoose.model("User", UserSchema);
  const Wallet = mongoose.models.Wallet || mongoose.model("Wallet", WalletSchema);

  const existing = await User.findOne({ username: USERNAME });
  if (existing) {
    console.log(`Admin user "${USERNAME}" already exists. Nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const admin = await User.create({
    username: USERNAME,
    passwordHash,
    role: "admin",
    status: "active",
  });

  await Wallet.create({ user: admin._id });

  console.log("Admin user created:");
  console.log(`  username: ${USERNAME}`);
  console.log(`  password: ${PASSWORD}`);
  console.log("Change this password after first login.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
