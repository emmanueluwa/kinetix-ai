"use client";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-red-300">
          Something went wrong
        </h2>
        <p className="text-xs text-zinc-400 leading-relaxed">
          {error.message ||
            "An unexpected error occurred while rendering Kinetix-AI."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="w-full min-h-11 bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-sm rounded-xl transition cursor-pointer"
        >
          Reload View
        </button>
      </div>
    </main>
  );
}
