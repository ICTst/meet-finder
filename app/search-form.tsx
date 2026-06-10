"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// 一文入力フォーム（解析中はローディング表示）
export function SearchForm({ initialQ }: { initialQ: string }) {
  const [q, setQ] = useState(initialQ);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="mb-4 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        // ソフト遷移にすることで、サーバー再レンダリング中 isPending が true になる
        startTransition(() => {
          router.push(`/?q=${encodeURIComponent(q)}`);
        });
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="例: 来週 長尾さんと60分"
        disabled={isPending}
        className="flex-1 rounded border px-3 py-2 text-sm disabled:bg-zinc-100"
      />
      <button
        type="submit"
        disabled={isPending}
        className="flex items-center gap-2 rounded bg-black px-4 py-2 text-sm text-white cursor-pointer disabled:opacity-60"
      >
        {isPending && (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
        )}
        {isPending ? "解析中…" : "解析"}
      </button>
    </form>
  );
}
