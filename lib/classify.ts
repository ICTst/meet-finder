import type { CalendarEvent } from "./google";

export type EventCategory =
  | "hard" // 確定会議・商談（動かせない）
  | "soft" // 作業時間・タスク枠（相談で動かせる）
  | "tentative" // 仮予定
  | "allday_block" // 終日ブロック
  | "free"; // 空きとして扱う（カウントしない）

// 機械シグナルで分かる分を先に判定。判定できなければ "ambiguous" を返す
export function classifyByMachineSignals(
  ev: CalendarEvent,
): EventCategory | "ambiguous" {
  if (ev.status === "cancelled") return "free"; // キャンセル
  if (ev.transparency === "transparent") return "free"; // 「空き時間」マーク
  if (ev.eventType === "workingLocation") return "free"; // 勤務地（予定ではない）
  if (ev.status === "tentative") return "tentative"; // 仮承諾
  if (ev.eventType === "outOfOffice") return "hard"; // 不在＝動かせない
  if (ev.eventType === "focusTime") return "soft"; // 集中時間＝ずらせる
  if (ev.start?.date && !ev.start?.dateTime) return "allday_block"; // 終日
  return "ambiguous"; // タイトル/内容を見ないと分からない → AIへ
}
