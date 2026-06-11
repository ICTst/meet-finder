import type { TargetEvents, CalendarEvent } from "./google";
import { classifyByMachineSignals, type EventCategory } from "./classify";
import { classifyAmbiguousEvents } from "./ai";

export type Interval = { start: number; end: number };
export type CategorizedTarget = {
  name: string;
  hard: Interval[]; // 動かせない予定
  soft: Interval[]; // soft + tentative（調整できるかも）
};

function durationMin(ev: CalendarEvent): number {
  const s = ev.start?.dateTime,
    e = ev.end?.dateTime;
  if (!s || !e) return 0;
  return Math.round((new Date(e).getTime() - new Date(s).getTime()) / 60000);
}

// 参加者の予定を機械シグナル＋AIで分類し、hard/soft の時間区間に振り分ける
export async function categorizeTargets(
  targets: TargetEvents[],
): Promise<CategorizedTarget[]> {
  // 1) 各イベントを機械分類。曖昧なものはAI用に集める
  const ambiguous: CalendarEvent[] = [];
  const cats: (EventCategory | "ambiguous")[][] = targets.map((t) =>
    t.events.map((ev) => {
      const c = classifyByMachineSignals(ev);
      if (c === "ambiguous") ambiguous.push(ev);
      return c;
    }),
  );

  // 2) 曖昧分をまとめてAI分類（同じ収集順で返る）
  const aiCats = await classifyAmbiguousEvents(
    ambiguous.map((ev) => ({
      summary: ev.summary ?? "(タイトルなし)",
      durationMinutes: durationMin(ev),
    })),
  );

  // 3) 各targetの hard/soft 区間へ振り分け（時刻ありのみ）
  let ai = 0;
  return targets.map((t, ti) => {
    const result: CategorizedTarget = { name: t.name, hard: [], soft: [] };
    t.events.forEach((ev, ei) => {
      let cat = cats[ti][ei];
      if (cat === "ambiguous") cat = aiCats[ai++] ?? "hard"; // AI結果を順に割当
      const s = ev.start?.dateTime,
        e = ev.end?.dateTime;
      if (!s || !e) return; // 終日・日時なしはスロット計算に使わない
      const iv = { start: new Date(s).getTime(), end: new Date(e).getTime() };
      if (cat === "hard") result.hard.push(iv);
      else if (cat === "soft" || cat === "tentative") result.soft.push(iv);
      // free / allday_block は入れない
    });
    return result;
  });
}
