// Next.js shows this immediately (before the server-rendered page.js finishes
// awaiting the DB) so the browser never sits on a blank white tab during a
// slow feed load — it streams this skeleton first, then swaps in the real
// feed the moment data is ready.
function CardSkeleton() {
  return (
    <div
      className="rounded-2xl border overflow-hidden mb-6"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="flex items-center gap-3 p-3">
        <div
          className="w-9 h-9 rounded-full shrink-0"
          style={{ background: "var(--surface-2)" }}
        />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-28 rounded" style={{ background: "var(--surface-2)" }} />
          <div className="h-2.5 w-16 rounded" style={{ background: "var(--surface-2)" }} />
        </div>
      </div>
      <div
        className="w-full aspect-square"
        style={{
          background:
            "linear-gradient(100deg, var(--surface) 30%, var(--surface-2) 50%, var(--surface) 70%)",
          backgroundSize: "200% 100%",
          animation: "leakreels-loading-shimmer 1.4s ease-in-out infinite",
        }}
      />
      <div className="p-3 space-y-2">
        <div className="h-3 w-3/4 rounded" style={{ background: "var(--surface-2)" }} />
        <div className="h-3 w-1/2 rounded" style={{ background: "var(--surface-2)" }} />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="max-w-3xl mx-auto px-4 pt-6">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
      <style>{`
        @keyframes leakreels-loading-shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
      `}</style>
    </div>
  );
}
