/**
 * Bulk content uploader for Reels.
 *
 * "content" নামের folder-এ video আর image — দুই ধরনের file-ই রাখা যাবে,
 * প্রতিটা আলাদা আলাদা post হিসেবে একটা নির্দিষ্ট user-এর account-এ upload হয়ে যাবে।
 *
 * ব্যবহার:
 *   1) নিচের CONFIG অংশ পূরণ করুন (site URL, username/password, folder path)।
 *   2) প্রজেক্টের ভেতর থেকে রান করুন:  node scripts/bulk-upload-content.js
 *      (Node.js v18 বা তার বেশি ভার্সন লাগবে — built-in fetch দরকার)
 *
 * এটা ঠিক app-এর upload page যা করে সেটাই করে: presigned URL নেয়,
 * file সরাসরি storage-এ পাঠায় (video হলে একটা frame বের করে থাম্বনেইল
 * হিসেবেও আপলোড করে), তারপর post তৈরি করে — শুধু browser ছাড়াই, command line থেকে।
 *
 * থাম্বনেইলের জন্য (শুধু video-এর ক্ষেত্রে) system-এ `ffmpeg` ইনস্টল থাকতে হবে
 * (যেমন: `sudo apt install ffmpeg` অথবা `brew install ffmpeg`)। ffmpeg না থাকলে
 * বা কোনো কারণে ব্যর্থ হলে script থেমে যাবে না — সেক্ষেত্রে শুধু ওই post-টা
 * থাম্বনেইল ছাড়াই তৈরি হবে।
 *
 * ⚠️  IMAGE UPLOAD ASSUMPTION: image-এর জন্য video-এর মতোই presigned-URL
 * flow ধরে নেওয়া হয়েছে, এন্ডপয়েন্ট: POST /api/uploads/image-presign
 * (body: { fileName, contentType, size } → response: { uploadUrl, publicUrl, key }),
 * ঠিক video-presign-এর মতোই। আপনার app-এ image upload-এর route আলাদা হলে
 * নিচের `presignImage` function-টা সেই route/response shape অনুযায়ী বদলে নিন।
 *
 * 🎲 AUTO RANDOM TITLE/HASHTAG: CONFIG.CAPTION এবং CONFIG.HASHTAGS ফাঁকা রাখলে
 * (এবং USE_FILENAME_AS_CAPTION false থাকলে), প্রতিটা upload-এর জন্য caption ও
 * hashtag আলাদাভাবে randomly বসানো হবে — video ও image দুই ধরনের file-এর
 * জন্যই (শুধু video না):
 *   - RANDOM_CAPTION_POOL থেকে একটা caption randomly বাছা হবে
 *   - RANDOM_HASHTAG_POOL থেকে RANDOM_HASHTAG_COUNTS-এ বলা সংখ্যা (৩ বা ৫টা)
 *     hashtag randomly বেছে caption-এর হ্যাশট্যাগ হিসেবে জোড়া লাগানো হবে
 * নিচের পুলগুলো নিজের মতো করে বদলে/বাড়িয়ে নিতে পারেন।
 *
 * 📒 PROGRESS FILE: প্রতিটা সফল upload-এর filename একটা .upload-progress.json
 * ফাইলে — script যে folder-এ আছে (এই scripts folder-এই) — save হয়ে যায়। পরের
 * বার script চালালে যেসব file আগে থেকেই ওই list-এ আছে সেগুলো automatically
 * skip হয়ে যাবে — একই video/image দুইবার post হয়ে যাওয়া থেকে বাঁচার জন্য।
 * কোনো file আবার নতুন করে upload করতে চাইলে, .upload-progress.json থেকে সেই
 * filename-টা মুছে দিন অথবা পুরো ফাইলটাই delete করে দিন (তাহলে সব file নতুন
 * করে ধরা হবে)।
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

// ─────────────────────────────── CONFIG ───────────────────────────────
const CONFIG = {
  // যে site-এ app চলছে (local dev হলে http://localhost:3000,
  // deploy করা থাকলে সেই domain, যেমন https://your-app.vercel.app)
  BASE_URL: "http://localhost:3000",

  // যে user-এর account-এ upload হবে তার username/email আর password
  IDENTIFIER: "rupali",
  PASSWORD: "king@billah",

  // যে folder-এ video ও image file গুলো আছে (এই script-এর সাপেক্ষে path, বা full path দিন)
  CONTENT_FOLDER: path.join(__dirname, "..", "content"),

  // প্রতিটা post-এ caption/hashtags/location — চাইলে ফাঁকা রাখতে পারেন
  // (ফাঁকা রাখলে নিচের RANDOM_CAPTION_POOL থেকে randomly একটা বসে যাবে)
  CAPTION: "",
  HASHTAGS: "",
  LOCATION: "",

  // true করলে filename (extension বাদে) caption হিসেবে বসবে,
  // উপরের CAPTION/random pool — কোনোটাই ব্যবহার হবে না
  USE_FILENAME_AS_CAPTION: false,

  // true থাকলে CAPTION/HASHTAGS ফাঁকা থাকা প্রতিটা post-এ (video ও image
  // দুই ক্ষেত্রেই) RANDOM_CAPTION_POOL থেকে randomly একটা caption+hashtag বসবে।
  // false করলে আগের মতোই caption/hashtag ফাঁকা থেকে যাবে।
  USE_RANDOM_TITLE: true,

  // দুইটা upload-এর মাঝে কত মিলিসেকেন্ড wait করবে (server-কে চাপ না দেওয়ার জন্য)
  DELAY_MS: 1500,

  // ভিডিওর কততম সেকেন্ডের frame থাম্বনেইল হিসেবে নেওয়া হবে
  THUMBNAIL_SEEK_SECONDS: 0.5,

  // যেসব file সফলভাবে upload হয়েছে তাদের নাম কোথায় track করে রাখা হবে
  // (script যে folder-এ আছে সেখানে .upload-progress.json নামে তৈরি হবে)
  PROGRESS_FILE_NAME: ".upload-progress.json",
};

// 🎲 random caption পুল — CONFIG.USE_RANDOM_TITLE true থাকলে এখান থেকে
// প্রতিটা upload-এর জন্য randomly একটা caption বেছে নেওয়া হবে।
// নিজের পছন্দমতো caption যোগ, বাদ, বা বদলে নিতে পারেন।
const RANDOM_CAPTION_POOL = ["Own your moment 🌟",
  "Create. Inspire. Repeat. 🎨",
  "Sunsets never disappoint 🌅",
  "The vibe is real ✨",
  "Keep life colorful 🌈",
  "Always worth it 💯",
  "Feel the freedom 🕊️",
  "Turn dreams into plans 🚀",
  "The story goes on 📖",
  "Just keep smiling 😊",
  "Magic happens daily ✨",
  "Every day feels new 🌄",
  "Find your own light 💡",
  "Never stop creating 🎬",
  "Peace over pressure 🍃",
  "Today's little adventure 🌍",
  "Keep your energy high ⚡",
  "One life. One chance. 💫",
  "The sky has no limits ☁️",
  "Small moments, big impact ❤️",
  "Born to shine ✨",
  "Keep your heart open 💖",
  "Live with no regrets 🌟",
  "The future looks bright 🌞",
  "Every smile tells a story 😄",
  "Catch the sunshine ☀️",
  "Believe. Achieve. Repeat. 🏆",
  "Every journey begins now 🛤️",
  "Stay in the moment ⏳",
  "Life feels lighter 🌸",
  "One more memory 📷",
  "Take the scenic route 🗺️",
  "Keep your soul happy 🌿",
  "Nothing but blue skies 🌤️",
  "The adventure continues 🚗",
  "Every day is a fresh page 📖",
  "Stay cool 😎",
  "Always moving upward ⬆️",
  "Life looks better today 🌈",
  "Keep chasing greatness 🏅",
  "The world is waiting 🌍",
  "Be fearless today 🦅",
  "Find joy everywhere 🌼",
  "The moment is yours 🎯",
  "Good vibes forever 🌟",
  "Dream beyond limits 🌌",
  "Life is calling 📞",
  "Take the leap 🪂",
  "More smiles ahead 😁",
  "Fresh air, fresh mind 🍃",
  "The journey is beautiful 🌄",
  "Stay positive always 💛",
  "The best view is ahead 🏞️",
  "New memories loading... ⏳",
  "Keep the balance ⚖️",
  "Find your rhythm 🎶",
  "A day to remember 📸",
  "One more beautiful sunset 🌇",
  "Keep your eyes up 👀",
  "Every step has meaning 👣",
  "Let happiness find you 🌸",
  "Live beyond expectations 🚀",
  "Smile at the little things 😊",
  "One amazing chapter 📚",
  "Feel every heartbeat 💓",
  "Rise with purpose 🌅",
  "Everything starts with hope 🌠",
  "Let your dreams fly 🕊️",
  "The view is worth it 🏔️",
  "Life tastes sweeter 🍯",
  "The perfect escape 🌴",
  "Nature heals 🌿",
  "Take it all in 🌊",
  "Your story matters 📖",
  "Celebrate today 🎉",
  "Keep the good times rolling 🎊",
  "A spark of happiness ✨",
  "Bright minds, bright days 💡",
  "Walk your own path 🚶",
  "Dreams never expire 🌟",
  "Keep exploring 🧭",
  "Every day brings hope 🌞",
  "Moments become treasures 💎",
  "Stay strong, stay kind 💪",
  "The world feels alive 🌍",
  "Shine wherever you go ✨",
  "Love every moment ❤️",
  "Adventure fuels the soul ⛺",
  "Keep climbing ⛰️",
  "Smile, it's contagious 😄",
  "Take the next step 👣",
  "Living in full color 🎨",
  "Nothing beats this feeling 💖",
  "Endless inspiration 🌠",
  "Every picture has a heartbeat 📷",
  "The moment feels right 🌈",
  "Keep reaching for more 🚀",
  "Every sunrise brings hope 🌅",
  "The best memories last forever 💕",
  "Enjoy every little victory 🏆",
  "Stay wild 🌿",
  "Dream big ✨",
  "Own the moment 💯",
  "Keep it real 😌",
  "Fresh vibes 🌈",
  "Making it happen 🚀",
  "Every second counts ⏰",
  "Just breathe 🍃",
  "Feeling alive 💥",
  "On my way 🌍",
  "Golden hour glow 🌅",
  "Simple moments ❤️",
  "Nothing but smiles 😄",
  "Positive energy ⚡",
  "Forever young 🌟",
  "Making waves 🌊",
  "Keep shining ☀️",
  "Believe in yourself 💪",
  "No limits 🚀",
  "Life feels good 😊",
  "Smile more 😁",
  "Peaceful mind 🕊️",
  "Enjoy the ride 🚗",
  "Collecting memories 📸",
  "Today's mood 😎",
  "One step closer 👣",
  "Stay humble 🌱",
  "Rise and shine 🌞",
  "Moments like these 💕",
  "Creating happiness 🌸",
  "Living with purpose 🎯",
  "Heart full of joy 💖",
  "Bright days ahead 🌤️",
  "Never stop exploring 🧭",
  "Keep moving forward ➡️",
  "Making every moment count ⏳",
  "Sunshine state of mind ☀️",
  "Take the chance 🎲",
  "Good things coming 🌠",
  "Just enjoy life 🍀",
  "Always inspired ✨",
  "Stay fearless 🦁",
  "Adventure begins 🌍",
  "Happy soul 🌸",
  "Dream. Believe. Achieve. 💫",
  "Keep chasing goals 🏆",
  "Born to explore 🗺️",
  "Every day matters 🌅",
  "Love this feeling ❤️",
  "The best is yet to come 🌟",
  "Keep your head high 👑",
  "Endless possibilities 🌌",
  "Find your spark 🔥",
  "Choose happiness 😊",
  "Be your own hero 🦸",
  "Living without regrets 💯",
  "Trust the journey 🛤️",
  "Stay curious 🔍",
  "Nothing can stop me 🚀",
  "Small steps, big dreams 🌠",
  "Find your freedom 🕊️",
  "Moments worth sharing 📷",
  "Just keep smiling 😄",
  "Feel the magic ✨",
  "Better every day 📈",
  "One life, live it 🌍",
  "Peace begins within 🌿",
  "Every sunrise is a blessing 🌄",
  "Keep your dreams alive 💭",
  "Living the dream 🌟",
  "Catch the moment 📸",
  "Simply unforgettable 💖",
  "Fresh start 🌅",
  "Sparkle every day ✨",
  "Keep your vibe high 🔥",
  "Be unstoppable 💪",
  "Follow your heart ❤️",
  "Enjoy every sunset 🌇",
  "Take it easy 🍃",
  "Smile and shine 🌞",
  "Journey never ends 🚶",
  "Life loves you 💕",
  "Find your adventure 🧭",
  "Make today amazing 🌈",
  "Enjoy every heartbeat 💓",
  "The world is yours 🌍",
  "Happy moments only 🌸",
  "Keep creating 🎨",
  "Stay grateful 🙏",
  "Find your peace 🌿",
  "Let your light shine 💡",
  "Beyond the horizon 🌅",
  "Every moment is special 💫",
  "Good times ahead 🎉",
  "Find your own path 🛤️",
  "Smile through it all 😄",
  "Never stop dreaming 🌠",
  "Life is beautiful 🌺",
  "Create your own story 📖",
  "Keep the fire alive 🔥",
  "Make memories forever 📸",
  "Just another day ✨",
  "Vibes only 🔥",
  "Living the moment 💫",
  "Catch this vibe 🌟",
  "New drop 🎬",
  "Can't stop watching this 👀",
  "Good vibes only 🌈",
  "This hits different 🎯",
  "Mood for the day 😎",
  "Life in motion 🎥",
  "Unforgettable moments 💖",
  "Pure bliss 🌸",
  "Chasing sunsets 🌅",
  "Weekend vibes 🍹",
  "Lost in the moment 🌌",
  "Making memories 📸",
  "Feeling unstoppable 💪",
  "Adventure awaits 🌍",
  "Living my best life 🌟",
  "Sunkissed and happy ☀️",
  "Dancing through life 💃",
  "Serenity now 🌿",
  "Embracing the chaos 🌪️",
  "Finding beauty everywhere 🌺",
  "Life is a journey 🚀",
  "Moments that matter 💕",
  "Chasing dreams and sunsets 🌄",
  "Happiness is homemade 🏡",
  "Smiles are contagious 😄",
  "Creating my own sunshine 🌞",
  "Wanderlust and city dust 🌆",
  "Living for the little things 🌸",
  "Making every day count ⏳",
  "Finding joy in the journey 🛤️",
  "Life is better with friends 👯‍♂️",
  "Savoring the simple pleasures 🍃",
  "Capturing memories one frame at a time 📷",
  "Letting go and embracing change 🌊",
  "Chasing the horizon 🌅",
  "Finding magic in the mundane ✨",
  "Life is a beautiful ride 🎢",
  "Exploring new horizons 🌄",
  "Dancing in the rain ☔",
  "Finding peace in chaos 🕊️",
  "Living for the moments that take your breath away 💨",
  "Finding strength in vulnerability 💪",
  "Embracing the unknown 🌌",
  "Life is a canvas, paint it your way 🎨",
  "Finding beauty in imperfection 🌸",
  "Chasing sunsets and dreams 🌅",
  "Living for the thrill of the unknown 🎢",
  "Finding joy in the journey, not just the destination 🛤️",
  "Life is a collection of moments, make them count ⏳",
  "Finding happiness in the little things 🌸",
  "Embracing the journey, not just the destination 🌄",
  "Life is a series of adventures, make them memorable 🌍",
  "Finding peace in the chaos of life 🕊️",
  "Living for the moments that make your heart race 💓",
  "Finding beauty in the everyday 🌺",
  "Chasing dreams and making them a reality 🌟",
  "Life is a journey, enjoy the ride 🚀",
  "Finding joy in the simple pleasures of life 🍃",
  "Embracing change and growth 🌱",
  "Living for the moments that make you feel alive 💫",
  "Finding magic in the ordinary ✨",
  "Life is a dance, move to your own rhythm 💃",
  "Finding strength in the face of adversity 💪",
  "Embracing the beauty of imperfection 🌸",
  "Living for the moments that take your breath away 💨",
  "Finding happiness in the present moment 🌸",
  "Chasing sunsets and making memories 🌅",
  "Life is a series of adventures, make them count 🌍",
  "Finding peace in the chaos of everyday life 🕊️",
  "Living for the moments that make your heart sing 🎶",
  "Finding beauty in the little things 🌺",
  "Chasing dreams and making them a reality 🌟",
  "Life is a journey, enjoy every step 🚶‍♂️",
  "Finding joy in the simple pleasures of life 🍃",
  "Embracing change and growth 🌱",
  "Living for the moments that make you feel alive 💫",
  "Finding magic in the ordinary ✨",
  "Life is a dance, move to your own rhythm 💃",
  "Finding strength in the face of adversity 💪",
  "Embracing the beauty of imperfection 🌸",
  "Living for the moments that take your breath away 💨",
  "Finding happiness in the present moment 🌸",
  "Chasing sunsets and making memories 🌅",
  "Life is a series of adventures, make them count 🌍",
  "Finding peace in the chaos of everyday life 🕊️",
  "Living for the moments that make your heart sing 🎶",
  "Finding beauty in the little things 🌺",
  "Chasing dreams and making them a reality 🌟",
  "Life is a journey, enjoy every step 🚶‍♂️",
  "Finding joy in the simple pleasures of life 🍃",
  "Embracing change and growth 🌱",
  "Living for the moments that make you feel alive 💫",
  "Finding magic in the ordinary ✨",
  "Life is a dance, move to your own rhythm 💃",
  "Finding strength in the face of adversity 💪",
  "Embracing the beauty of imperfection 🌸",
  "Living for the moments that take your breath away 💨",
  "Finding happiness in the present moment 🌸",
  "Chasing sunsets and making memories 🌅",
  "Life is a series of adventures, make them count 🌍",
  "Finding peace in the chaos of everyday life 🕊️",
  "Living for the moments that make your heart sing 🎶",
  "Finding beauty in the little things 🌺",
  "Chasing dreams and making them a reality 🌟",
  "Life is a journey, enjoy every step 🚶‍♂️",
  "Finding joy in the simple pleasures of life 🍃",
  "Embracing change and growth 🌱",
  "Living for the moments that make you feel alive 💫",
  "Finding magic in the ordinary ✨",
  "Life is a dance, move to your own rhythm 💃",
  "Finding strength in the face of adversity 💪",
  "Embracing the beauty of imperfection 🌸",
  "Living for the moments that take your breath away 💨",
  "Finding happiness in the present moment 🌸",
  "Chasing sunsets and making memories 🌅",
  "Life is a series of adventures, make them count 🌍",
  "Finding peace in the chaos of everyday life 🕊️",
  "Living for the moments that make your heart sing 🎶",
  "Finding beauty in the little things 🌺",
  "Chasing dreams and making them a reality 🌟",
  "Life is a journey, enjoy every step 🚶‍♂️",
  "Finding joy in the simple pleasures of life 🍃",
  "Embracing change and growth 🌱",
  "Living for the moments that make you feel alive 💫",
  "Finding magic in the ordinary  ✨",
  "Life is a dance, move to your own rhythm 💃",
  "Finding strength in the face of adversity 💪",
  "Embracing the beauty of imperfection 🌸",
  "Living for the moments that take your breath away 💨",
  "Finding happiness in the present moment 🌸",
  "Chasing sunsets and making memories 🌅",
  "Life is a series of adventures, make them count 🌍",
  "Finding peace in the chaos of everyday life 🕊️",
  "Living for the moments that make your heart sing 🎶",
  "Finding beauty in the little things 🌺",
  "Chasing dreams and making them a reality 🌟",
  "Life is a journey, enjoy every step 🚶‍♂️",
  "Finding joy in the simple pleasures of life 🍃",
  "Embracing change and growth 🌱",
  "Living for the moments that make you feel alive 💫",
  "Eyes on the future 🚀",
  "One frame, endless memories 📸",
  "Just getting started 🌟",
  "Moments worth reliving 💫",
  "Energy never lies ⚡",
  "Today's chapter 📖",
  "Nothing but good times 😄",
  "Keep the momentum 🔥",
  "Own your story 🎬",
  "Made for this 💯",
  "Forever chasing light 🌞",
  "Lost in the music 🎵",
  "The view says it all 🌄",
  "A little magic every day ✨",
  "Always in my element 🌊",
  "Finding my flow 🌊",
  "Keep the dream alive 🌠",
  "Here for the memories ❤️",
  "One vibe at a time 🌈",
  "Living with intention 🌱",
  "Every picture tells a story 📷",
  "Fresh perspective 👀",
  "This moment matters ⏳",
  "Stay inspired 💡",
  "Living beyond limits 🚁",
  "Sky above, dreams ahead ☁️",
  "Every heartbeat counts 💓",
  "Just enjoy the silence 🌌",
  "The journey continues 🛤️",
  "Glow from within ✨",
  "Adventure is calling 📍",
  "Create your own path 🧭",
  "Just another masterpiece 🎨",
  "A beautiful escape 🌴",
  "Pure happiness unlocked 😍",
  "Keep the spark alive ✨",
  "All smiles today 😄",
  "Good energy wins ⚡",
  "Living the good life 🍀",
  "Another unforgettable day 🌅",
  "Step into the unknown 🚪",
  "A world full of wonder 🌍",
  "Make it unforgettable 💖",
  "Sunshine and smiles 🌞",
  "Life without filters 🌈",
  "Moments over things 📸",
  "The vibe is unmatched 🔥",
  "Always moving forward ➡️",
  "Dream it. Live it. 🌟",
  "Keep it simple 🍃",
  "Every second shines ✨",
  "Never stop believing 💫",
  "Ready for more 🚀",
  "This is the feeling 💕",
  "Collecting little joys 🌸",
  "Keep chasing better 📈",
  "No bad days 🌞",
  "The best moments are real ❤️",
  "Limitless possibilities 🌌",
  "Golden memories 🌅",
  "Always finding joy 😊",
  "A life well lived 🌍",
  "Bright minds shine brighter 💡",
  "Another day to smile 😁",
  "Simple vibes only 🍂",
  "Every day is a gift 🎁",
  "The road ahead 🛣️",
  "Keep your spirit high 🦅",
  "Find your happy place 🌴",
  "Small wins matter 🏅",
  "More than a moment 💫",
  "Take it one day at a time 🌱",
  "Inspired by today 🌤️",
  "Live with passion ❤️‍🔥",
  "Stay focused 🎯",
  "Everything feels right 🌈",
  "Heart over everything ❤️",
  "Never lose your spark ✨",
  "Keep growing 🌱",
  "Adventure starts now 🌍",
  "Just enjoy the view 🌄",
  "Every smile is a victory 😄",
  "Moments become memories 📸",
  "Living free 🕊️",
  "Always something beautiful 🌺",
  "Let the good times roll 🎉",
  "Dreams in motion 🚀",
  "Stay true to yourself 🌟",
  "Keep your light bright 💡",
  "Today's little miracle 🌸",
  "Every sunset has a story 🌇",
  "Joy in every step 👣",
  "Keep reaching higher 🏔️",
  "Smile, breathe, repeat 😊",
  "A perfect little moment 💖",
  "Find beauty in now 🌼",
  "Nothing but endless vibes 🌊",
  "Live boldly 🔥",
  "More memories to make 📷",
  "The adventure never ends 🧭"
];

// 🎲 random hashtag পুল — CONFIG.USE_RANDOM_TITLE true থাকলে এখান থেকে
// প্রতিটা upload-এর জন্য randomly ৩টা বা ৫টা hashtag বেছে জোড়া লাগানো হবে
// (কতটা নেবে সেটা RANDOM_HASHTAG_COUNTS-এ ঠিক করা যায়)। যত বেশি hashtag এখানে
// রাখবেন, তত বেশি variation আসবে — চাইলে এই list বাড়িয়ে/কমিয়ে নিতে পারেন।
const RANDOM_HASHTAG_POOL = [
  "#reels",
  "#trending",
  "#viral",
  "#explorepage",
  "#fyp",
  "#mood",
  "#instagood",
  "#reelsvideo",
  "#trend",
  "#foryou",
  "#instareels",
  "#explore",
  "#newpost",
  "#reelitfeelit",
  "#viralvideo",
  "#reelsinstagram",
  "#instadaily",
  "#reelsindia",
  "#viralreels",
  "#trendingnow",
  "#viralcontent",
  "#viral2026",
  "#viralpost",
  "#viraltrend",
  "#viralreel",
  "#viralclip",
  "#viralclips",
  "#viralnow",
  "#viralfeed",
  "#viralpage",
  "#viralmoment",
  "#viralmedia",
  "#trendalert",
  "#trendsetter",
  "#trendingsong",
  "#trendingaudio",
  "#exploremore",
  "#explorefeed",
  "#exploregram",
  "#exploretoday",
  "#explorelife",
  "#exploreworld",
  "#exploreeverything",
  "#discover",
  "#discovermore",
  "#foryoupage",
  "#foryoufeed",
  "#fyppage",
  "#fypシ",
  "#fypviral",
  "#fyp2026",
  "#reelsdaily",
  "#reelsoftheday",
  "#reelslover",
  "#reelslove",
  "#reelsfun",
  "#reelslife",
  "#reelscreator",
  "#reelscommunity",
  "#reelsviral",
  "#reelstrending",
  "#reelsfeature",
  "#reelsworld",
  "#reelscontent",
  "#reelvideo",
  "#reeltrend",
  "#reelstar",
  "#instareel",
  "#instagram",
  "#instagramreels",
  "#instalove",
  "#instamood",
  "#instalife",
  "#instafeed",
  "#instapic",
  "#instaclip",
  "#instavideo",
  "#instafamous",
  "#instacreator",
  "#socialmedia",
  "#contentcreator",
  "#creator",
  "#creatorlife",
  "#creatorcommunity",
  "#digitalcreator",
  "#videocreator",
  "#creative",
  "#creativecontent",
  "#creativevideo",
  "#creativeideas",
  "#creativeworld",
  "#cinematic",
  "#videography",
  "#photography",
  "#mobilecreator",
  "#mobilevideo",
  "#mobilephotography",
  "#editing",
  "#videoedit",
  "#transition",
  "#slowmotion",
  "#qualitycontent",
  "#topreels",
  "#bestcontent",
  "#watchnow",
  "#mustwatch",
  "#mustsee",
  "#watchthis",
  "#share",
  "#follow",
  "#followme",
  "#like",
  "#comment",
  "#support",
  "#community",
  "#engagement",
  "#reach",
  "#audience",
  "#newreel",
  "#newcontent",
  "#newvideo",
  "#freshcontent",
  "#freshreels",
  "#freshvibes",
  "#goodvibes",
  "#positivevibes",
  "#positiveenergy",
  "#happiness",
  "#joy",
  "#smile",
  "#happy",
  "#motivation",
  "#motivationdaily",
  "#inspiration",
  "#dreambig",
  "#mindset",
  "#success",
  "#goals",
  "#focus",
  "#workhard",
  "#grind",
  "#keepgoing",
  "#nevergiveup",
  "#selflove",
  "#selfgrowth",
  "#confidence",
  "#believe",
  "#livethelife",
  "#enjoylife",
  "#lifestyle",
  "#lifeisgood",
  "#lifequotes",
  "#moments",
  "#memories",
  "#friendship",
  "#friends",
  "#love",
  "#nature",
  "#travel",
  "#adventure",
  "#wanderlust",
  "#weekend",
  "#weekendvibes",
  "#summer",
  "#sunrise",
  "#sunset",
  "#sky",
  "#beautiful",
  "#amazing",
  "#awesome",
  "#epic",
  "#legendary",
  "#cool",
  "#wow",
  "#energy",
  "#vibes",
  "#today",
  "#daily",
  "#dailypost",
  "#dailyreels",
  "#dailycontent",
  "#dailyviral",
  "#dailymotivation",
  "#dailyinspiration",
  "#feature",
  "#featureme",
  "#popular",
  "#popularpage",
  "#global",
  "#worldwide",
  "#online",
  "#internet",
  "#shortvideo",
  "#shortvideos",
  "#shorts",
  "#viralshorts",
  "#clip",
  "#videos",
  "#entertainment",
  "#music",
  "#dance",
  "#artist",
  "#camera",
  "#production",
  "#filmmaking",
  "#filmmaker",
  "#creatorgram",
  "#instatrend",
  "#reelspage",
  "#viralcommunity",
  "#bestreels",
  "#toppost",
  "#content",
  "#video",
  "#trendingsongs",
  "#exploredaily",
  "#reelsmania",
  "#instamoment",
  "#instalifestyle",
  "#dailyvibes",
  "#goodtimes",
  "#bestmoment",
  "#coolvibes",
  "#creativepost",
  "#videooftheday",
  "#photooftheday",
  "#moment",
  "#now",
  "#fun",
  "#funny",
  "#edit",
  "#aesthetic",
  "#aestheticvideo",
  "#aestheticreels",
  "#minimal",
  "#colorful",
  "#reelkarofeelkaro",
  "#exploremorepage",
  "#social",
  "#newday",
  "#newvibes",
  "#freshstart",
  "#goodday",
  "#mustfollow",
  "#keepwatching",
  "#nextlevel",
  "#exploreworld"
];

// প্রতিটা post-এ কতটা hashtag বসবে — এখান থেকে randomly একটা সংখ্যা বাছা হবে
const RANDOM_HASHTAG_COUNTS = [3,2,5,4,3,2,3,4,5,3,2,4,3,5,4,3,2,5,4,3];
// ────────────────────────────────────────────────────────────────────

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const ALL_EXTENSIONS = [...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS];

const CONTENT_TYPE_BY_EXT = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const MAX_BYTES_BY_TYPE = {
  video: 50 * 1024 * 1024, // app-এর নিজের 50MB video limit
  image: 15 * 1024 * 1024, // image-এর জন্য একটু কম ধরে নেওয়া হয়েছে, দরকারে বদলান
};

function mediaTypeForExt(ext) {
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// .upload-progress.json থেকে আগে যেসব file upload হয়ে গেছে তাদের নামের list
// পড়া হচ্ছে। file না থাকলে বা পড়তে সমস্যা হলে খালি list ধরে নেওয়া হয়।
function loadProgress(progressPath) {
  try {
    const raw = fs.readFileSync(progressPath, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data.uploaded)) return new Set(data.uploaded);
  } catch (err) {
    // file নেই বা corrupt — নতুন করে শুরু করা হচ্ছে
  }
  return new Set();
}

// নতুন করে upload হওয়া filename progress file-এ যোগ করে সাথে সাথে disk-এ save
// করে দেওয়া হয় (স্ক্রিপ্ট মাঝপথে থেমে গেলেও যতটুকু upload হয়েছে সেটুকু যেন হারিয়ে না যায়)।
function saveProgress(progressPath, uploadedSet) {
  const data = { uploaded: Array.from(uploadedSet), updatedAt: new Date().toISOString() };
  fs.writeFileSync(progressPath, JSON.stringify(data, null, 2), "utf8");
}

function pickRandomCaption() {
  return RANDOM_CAPTION_POOL[Math.floor(Math.random() * RANDOM_CAPTION_POOL.length)];
}

function pickRandomHashtags() {
  const count = RANDOM_HASHTAG_COUNTS[Math.floor(Math.random() * RANDOM_HASHTAG_COUNTS.length)];
  const pool = [...RANDOM_HASHTAG_POOL];
  const picked = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1); // duplicate hashtag এড়াতে বেছে নেওয়ারটা pool থেকে বাদ দেওয়া হচ্ছে
  }
  return picked.join(" ");
}

// login response-এর Set-Cookie header থেকে session cookie বের করে নেওয়া হয়,
// পরের প্রতিটা request-এ সেই cookie পাঠানো লাগবে (নাহলে "Sign in required" আসবে)।
function extractCookies(res) {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function login() {
  const res = await fetch(`${CONFIG.BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: CONFIG.IDENTIFIER,
      password: CONFIG.PASSWORD,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Login failed (status ${res.status})`);
  }
  const cookie = extractCookies(res);
  if (!cookie) {
    throw new Error("Login succeeded but no session cookie was returned.");
  }
  console.log(`Logged in as ${data.user?.username || CONFIG.IDENTIFIER}`);
  return cookie;
}

async function presignVideo(cookie, fileName, contentType, size) {
  const res = await fetch(`${CONFIG.BASE_URL}/api/uploads/video-presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ fileName, contentType, size }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Video presign failed (status ${res.status})`);
  }
  return data; // { uploadUrl, publicUrl, key }
}

// ⚠️ ধরে নেওয়া হয়েছে video-presign-এর মতোই একটা /api/uploads/image-presign
// route আছে, একই request/response shape নিয়ে। না থাকলে এখানে বদলে দিন।
async function presignImage(cookie, fileName, contentType, size) {
  const res = await fetch(`${CONFIG.BASE_URL}/api/uploads/image-presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ fileName, contentType, size }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Image presign failed (status ${res.status})`);
  }
  return data; // { uploadUrl, publicUrl, key }
}

async function uploadToStorage(uploadUrl, buffer, contentType) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: buffer,
  });
  if (!res.ok) {
    throw new Error(`Upload to storage failed (status ${res.status})`);
  }
}

// app-এর upload page ব্রাউজারে <video>+<canvas> দিয়ে ভিডিওর একটা frame ক্যাপচার
// করে থাম্বনেইল বানায় — কিন্তু এই script Node.js-এ (browser ছাড়া) চলে, তাই সেই
// DOM API এখানে নেই। এর বদলে system-এ ইনস্টল করা `ffmpeg` দিয়ে একই কাজ করা হচ্ছে:
// ভিডিও থেকে একটা frame বের করে JPEG হিসেবে সেভ করা হয়। (image file-এর জন্য এটা লাগে না।)
function extractThumbnailWithFfmpeg(videoPath) {
  return new Promise((resolve) => {
    const outPath = path.join(
      os.tmpdir(),
      `leakreels-thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
    );
    execFile(
      "ffmpeg",
      [
        "-y",
        "-ss", String(CONFIG.THUMBNAIL_SEEK_SECONDS),
        "-i", videoPath,
        "-frames:v", "1",
        "-q:v", "3",
        outPath,
      ],
      (err) => {
        if (err || !fs.existsSync(outPath)) {
          resolve(null); // ffmpeg না থাকলে বা ব্যর্থ হলে best-effort — thumbnail ছাড়াই এগিয়ে যাবে
          return;
        }
        resolve(outPath);
      }
    );
  });
}

async function uploadThumbnail(cookie, thumbPath) {
  const buffer = fs.readFileSync(thumbPath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "image/jpeg" }), "thumbnail.jpg");

  const res = await fetch(`${CONFIG.BASE_URL}/api/uploads/thumbnail`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  fs.unlink(thumbPath, () => { }); // temp file পরিষ্কার করে দেওয়া
  if (!res.ok) {
    throw new Error(data.error || `Thumbnail upload failed (status ${res.status})`);
  }
  return data.url || "";
}

async function createPost(cookie, { url, key, mediaType, caption, hashtags, location, thumbnailUrl }) {
  const res = await fetch(`${CONFIG.BASE_URL}/api/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      caption,
      hashtags,
      location,
      thumbnailUrl: thumbnailUrl || "", // video হলে ffmpeg দিয়ে বানানো frame, image হলে খালি (app নিজেই ছবিটা thumbnail হিসেবে দেখায় ধরে নেওয়া হয়েছে)
      mediaItems: [{ url, key, mediaType }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Post creation failed (status ${res.status})`);
  }
  return data.post;
}

async function main() {
  if (!fs.existsSync(CONFIG.CONTENT_FOLDER)) {
    throw new Error(`Content folder পাওয়া যায়নি: ${CONFIG.CONTENT_FOLDER}`);
  }

  const files = fs
    .readdirSync(CONFIG.CONTENT_FOLDER)
    .filter((name) => ALL_EXTENSIONS.includes(path.extname(name).toLowerCase()))
    .sort();

  if (files.length === 0) {
    console.log("এই folder-এ কোনো video (.mp4/.webm/.mov) বা image (.jpg/.jpeg/.png/.webp/.gif) file পাওয়া যায়নি।");
    return;
  }

  const videoCount = files.filter((f) => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase())).length;
  const imageCount = files.length - videoCount;

  const progressPath = path.join(__dirname, CONFIG.PROGRESS_FILE_NAME);
  const alreadyUploaded = loadProgress(progressPath);
  const pendingFiles = files.filter((f) => !alreadyUploaded.has(f));
  const skippedAlready = files.length - pendingFiles.length;

  console.log(`${files.length}টা file পাওয়া গেছে (${videoCount}টা video, ${imageCount}টা image)।`);
  if (skippedAlready > 0) {
    console.log(`${skippedAlready}টা file আগেই ${CONFIG.PROGRESS_FILE_NAME}-এ upload হিসেবে চিহ্নিত আছে, বাকি ${pendingFiles.length}টা upload হবে।`);
  }
  if (pendingFiles.length === 0) {
    console.log("নতুন কোনো file নেই — সব file আগেই upload হয়ে গেছে।");
    return;
  }
  console.log("Upload শুরু হচ্ছে...\n");

  const cookie = await login();

  let uploaded = 0;
  let failed = 0;

  for (const fileName of pendingFiles) {
    const filePath = path.join(CONFIG.CONTENT_FOLDER, fileName);
    const ext = path.extname(fileName).toLowerCase();
    const mediaType = mediaTypeForExt(ext);
    const contentType = CONTENT_TYPE_BY_EXT[ext];
    const stat = fs.statSync(filePath);
    const maxBytes = MAX_BYTES_BY_TYPE[mediaType];

    process.stdout.write(`→ [${mediaType}] ${fileName} (${(stat.size / (1024 * 1024)).toFixed(1)} MB) ... `);

    if (stat.size > maxBytes) {
      console.log(`SKIP (${(maxBytes / (1024 * 1024)).toFixed(0)}MB limit-এর চেয়ে বড়)`);
      failed++;
      continue;
    }

    try {
      const buffer = fs.readFileSync(filePath);
      const presign =
        mediaType === "video"
          ? await presignVideo(cookie, fileName, contentType, stat.size)
          : await presignImage(cookie, fileName, contentType, stat.size);
      await uploadToStorage(presign.uploadUrl, buffer, contentType);

      let thumbnailUrl = "";
      if (mediaType === "video") {
        const thumbPath = await extractThumbnailWithFfmpeg(filePath);
        if (thumbPath) {
          try {
            thumbnailUrl = await uploadThumbnail(cookie, thumbPath);
          } catch (thumbErr) {
            console.log(`\n   (থাম্বনেইল আপলোড ব্যর্থ, thumbnail ছাড়াই post হবে: ${thumbErr.message})`);
          }
        }
      }

      // caption/hashtags ঠিক করা হচ্ছে: filename > নির্দিষ্ট CONFIG value >
      // (ফাঁকা হলে ও USE_RANDOM_TITLE চালু থাকলে) random pool থেকে একটা এন্ট্রি।
      let caption = CONFIG.CAPTION;
      let hashtags = CONFIG.HASHTAGS;

      if (CONFIG.USE_FILENAME_AS_CAPTION) {
        caption = path.basename(fileName, ext);
      } else if (CONFIG.USE_RANDOM_TITLE && !caption && !hashtags) {
        caption = pickRandomCaption();
        hashtags = pickRandomHashtags();
      }

      await createPost(cookie, {
        url: presign.publicUrl,
        key: presign.key,
        mediaType,
        caption,
        hashtags,
        location: CONFIG.LOCATION,
        thumbnailUrl,
      });

      console.log(thumbnailUrl ? "OK, post ও থাম্বনেইল তৈরি হয়েছে ✔" : "OK, post তৈরি হয়েছে ✔");
      uploaded++;

      // সাথে সাথে progress file-এ save করা হচ্ছে, যাতে মাঝপথে script থেমে
      // গেলেও এতক্ষণ যা upload হয়েছে সেটা পরের বার আর re-upload না হয়।
      alreadyUploaded.add(fileName);
      saveProgress(progressPath, alreadyUploaded);
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      failed++;
    }

    await sleep(CONFIG.DELAY_MS);
  }

  console.log(`\nশেষ। ${uploaded}টা upload হয়েছে, ${failed}টা ব্যর্থ হয়েছে। (${CONFIG.PROGRESS_FILE_NAME}-এ মোট ${alreadyUploaded.size}টা file upload হিসেবে save আছে)`);
}

main().catch((err) => {
  console.error("\nScript বন্ধ হয়ে গেছে:", err.message);
  process.exit(1);
});