"use server";

import { auth } from "@/auth";
import { checkFreeBusy, insertEvent } from "@/lib/google";

export type BookResult =
  | { ok: true; htmlLink: string }
  | { ok: false; message: string };

export async function bookMeeting(
  _prev: BookResult | null,
  formData: FormData,
): Promise<BookResult> {
  const session = await auth();
  if (!session?.accessToken) {
    return { ok: false, message: "ログインが必要です。" };
  }

  const start = String(formData.get("start"));
  const end = String(formData.get("end"));
  const summary = String(formData.get("summary"));
  const attendees = JSON.parse(String(formData.get("attendees"))) as string[];

  // ① 確定直前に再チェック（提示〜確定の間に埋まっていないか）
  const fb = await checkFreeBusy(session.accessToken, attendees, start, end);
  if (!fb.allFree) {
    return { ok: false, message: "直前に予定が入りました。別の候補を選んでください。" };
  }

  // ② 予定作成（通知なし）
  try {
    const ev = await insertEvent(session.accessToken, { summary, start, end, attendees });
    return { ok: true, htmlLink: ev.htmlLink };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "作成に失敗しました。" };
  }
}
