"use client";

import { useActionState } from "react";
import { bookMeeting, type BookResult } from "./actions";

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
    <form action={formAction} className="mt-2 flex items-center gap-2">
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="end" value={end} />
      <input type="hidden" name="summary" value={summary} />
      <input type="hidden" name="attendees" value={JSON.stringify(attendees)} />
      <button
        type="submit"
        disabled={isPending || state?.ok === true}
        className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white cursor-pointer disabled:opacity-60"
      >
        {isPending ? "予約中…" : state?.ok ? "予約済み ✓" : "この時間で予約"}
      </button>
      {state && !state.ok && (
        <span className="text-xs text-red-600">{state.message}</span>
      )}
      {state?.ok && (
        <a
          href={state.htmlLink}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 underline"
        >
          カレンダーで開く
        </a>
      )}
    </form>
  );
}
