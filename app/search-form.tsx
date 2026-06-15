"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// 一文入力フォーム（解析中はローディング表示）
export function SearchForm({ initialQ }: { initialQ: string }) {
  const [q, setQ] = useState(initialQ);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="mb-6 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        // ソフト遷移にすることで、サーバー再レンダリング中 isPending が true になる
        startTransition(() => {
          router.push(`/?q=${encodeURIComponent(q)}`);
        });
      }}
    >
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="例: 来週 長尾さんと60分"
        disabled={isPending}
      />
      <Button type="submit" disabled={isPending}>
        {isPending && (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        {isPending ? "解析中…" : "解析"}
      </Button>
    </form>
  );
}
