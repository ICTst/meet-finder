"use client";

import { useActionState } from "react";
import { bookMeeting, type BookResult } from "./actions";
import { Button } from "@/components/ui/button";

export function BookButton({
  start,
  end,
  summary,
  attendees,
}: {
  start: string;
  end: string;
  summary: string;
  attendees: string[];
}) {
  const [state, formAction, isPending] = useActionState<BookResult | null, FormData>(
    bookMeeting,
    null,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="end" value={end} />
      <input type="hidden" name="summary" value={summary} />
      <input type="hidden" name="attendees" value={JSON.stringify(attendees)} />
      <Button type="submit" size="sm" disabled={isPending || state?.ok === true}>
        {isPending ? "予約中…" : state?.ok ? "予約済み ✓" : "この時間で予約"}
      </Button>
      {state && !state.ok && (
        <span className="text-xs text-destructive">{state.message}</span>
      )}
      {state?.ok && (
        <a
          href={state.htmlLink}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary underline underline-offset-4"
        >
          カレンダーで開く
        </a>
      )}
    </form>
  );
}
