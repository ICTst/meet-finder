import type { CalendarEvent } from "./google";

export type EventCategory =
  | "hard" // 確定会議・商談（動かせない）
  | "soft" // 作業時間・タスク枠（相談で動かせる）
  | "tentative" // 仮予定
  | "allday_block" // 終日ブロック
  | "free"; // 空きとして扱う（カウントしない）

// タイトルに単語 "fix" を含めば「動かせない予定」の明示マーク（先頭でなくてもOK）。
// 単語境界マッチなので prefix / suffix / affix 等には反応しない。
export function hasFixKeyword(summary?: string): boolean {
  if (!summary) return false;
  return /\bfix\b/i.test(summary);
}

// 自分以外の参加者（人 or 会議室などのリソース）がいる＝実会議とみなす
function hasOtherAttendees(ev: CalendarEvent): boolean {
  return (ev.attendees ?? []).some((a) => a.self !== true);
}

// 「（名前）出社 / テレワーク」等の勤務形態メモは予定ではない（空き扱い）。書式は固定運用
function isWorkLocationNote(summary?: string): boolean {
  if (!summary) return false;
  return /出社|テレワーク/.test(summary);
}

// 機械シグナルで分かる分を先に判定。判定できなければ "ambiguous" を返す
export function classifyByMachineSignals(
  ev: CalendarEvent,
): EventCategory | "ambiguous" {
  if (ev.status === "cancelled") return "free"; // キャンセル
  if (ev.transparency === "transparent") return "free"; // 「空き時間」マーク
  if (ev.eventType === "workingLocation") return "free"; // 勤務地（予定ではない）
  if (isWorkLocationNote(ev.summary)) return "free"; // 出社/テレワークのメモは予定ではない
  if (hasFixKeyword(ev.summary)) return "hard"; // タイトルに fix → 動かせない（最優先）
  if (ev.status === "tentative") return "tentative"; // 仮承諾（参加者がいても未確定なので仮扱い）
  if (hasOtherAttendees(ev)) return "hard"; // 自分以外の参加者がいる＝実会議→動かせない
  if (ev.eventType === "outOfOffice") return "hard"; // 不在＝動かせない
  if (ev.eventType === "focusTime") return "soft"; // 集中時間＝ずらせる
  if (ev.start?.date && !ev.start?.dateTime) return "allday_block"; // 終日
  return "ambiguous"; // タイトル/内容を見ないと分からない → AIへ
}
