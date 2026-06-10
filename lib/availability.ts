import type { TargetEvents, CalendarEvent } from "./google";

export type Slot = {
  start: string; 
  end: string 
};

const BUSINESS_START_HOUR = 9; // 営業開始 9:00
const BUSINESS_END_HOUR = 18; //  営業終了 18:00（昼休みは除外しない）

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// JSTの「今日」を YYYY-MM-DD で取得
function todayYmdJst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo"
  }).format(new Date());
}

// 1カレンダー分のイベント → busy区間（epoch ms）に変換
function busyIntervalsOf(events: CalendarEvent[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const ev of events) {
    if (ev.status === "cancelled") continue; // キャンセル済みは無視
    if (ev.transparency === "transparent") continue; // 「空き時間」マークは空き扱い
    const s = ev.start?.dateTime;
    const e = ev.end?.dateTime;
    if (!s || !e) continue; // 終日予定はM2では対象外（M6でAI分類）
    out.push({ start: new Date(s).getTime(), end: new Date(e).getTime() });
  }
  return out;
}

// 対象全員＋会議室の予定から busy区間を合算する
function collectBusy(targets: TargetEvents[]): { start: number; end: number }[] {
  return targets.flatMap((t) => busyIntervalsOf(t.events));
}

// 共通空きスロットを算出（全員＋会議室が空いている duration 分の枠）
export function findCommonFreeSlots(
  targets: TargetEvents[],
  durationMinutes: number = 60,
  options?: {
    days?: number;
    stepMinutes?: number;
  }
): Slot[] {
  const days = options?.days ?? 14; // 翌日から2週間
  const step = options?.stepMinutes ?? 30; // 30分刻みで予定を探す
  const busy = collectBusy(targets);

  const slots: Slot[] = [];
  // 今日のJST 0:00 を基準に、日本はサマータイム無し → 1日=86400000ms 加算で確実に翌日同時刻
  const baseMidnight = new Date(`${todayYmdJst()}T00:00:00+09:00`).getTime();

  for (let i = 1; i <= days; i++) {
    const dayMs = baseMidnight + i * 86400000;
    const dayDate = new Date(dayMs);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(dayDate);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
    }).format(dayDate);

    if (weekday === "Sat" || weekday === "Sun") continue; // 土日は表示しない
    
    // 9:00から18:00まで、step分刻みで候補開始時刻をつくる
    const lastStartMinute = BUSINESS_END_HOUR * 60 - durationMinutes;
    for (let m = BUSINESS_START_HOUR * 60; m <= lastStartMinute; m += step) {
      const startIso = `${ymd}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00+09:00`;
      const startMs = new Date(startIso).getTime();
      const endMs = startMs + durationMinutes * 60000;

      // どの busy 区間とも重ならなければ「全員＋会議室が空き」
      const overlaps = busy.some((b) => startMs < b.end && b.start < endMs);
      if (!overlaps) {
        const endMin = m + durationMinutes;
        const endIso = `${ymd}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00+09:00`;
        slots.push({ start: startIso, end: endIso });
      }
    }
  }
  return slots;
}

// ===== 週サマリー（ヒートマップ）=====

export type SummaryCell = {
  timeLabel: string; // "09:00"
  freePeople: number; // この30分に空いている人数
  roomBusy: boolean; // この30分に会議室が予約済みか
};
export type SummaryDay = { label: string; cells: SummaryCell[] };
export type WeekSummary = {
  timeLabels: string[];
  days: SummaryDay[];
  totalPeople: number;
};

// 今週の月〜金（JST）を YYYY-MM-DD と表示ラベルで返す
function thisWeekWeekdays(): { ymd: string; label: string }[] {
  const base = new Date(`${todayYmdJst()}T00:00:00+09:00`).getTime();
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(new Date(base));
  const dow: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const offsetToMonday = (dow[wd] + 6) % 7; // 月曜まで何日戻るか
  const mondayMs = base - offsetToMonday * 86400000;

  const out: { ymd: string; label: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(mondayMs + i * 86400000);
    out.push({
      ymd: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d),
      label: d.toLocaleDateString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        weekday: "short",
      }),
    });
  }
  return out;
}

// 週サマリーを組み立てる（人の空き濃淡＋会議室占有）
export function buildWeekSummary(
  targets: TargetEvents[],
  roomCalendarId: string,
): WeekSummary {
  // 人と会議室を分ける
  const peopleBusy = targets
    .filter((t) => t.calendarId !== roomCalendarId)
    .map((t) => busyIntervalsOf(t.events));
  const room = targets.find((t) => t.calendarId === roomCalendarId);
  const roomBusy = room ? busyIntervalsOf(room.events) : [];

  // 時間行（9:00〜18:00 の 30分刻み）。ラベルは「開始–終了」の範囲表記
  const timeLabels: string[] = [];
  const minutes: number[] = [];
  for (let m = 9 * 60; m < 18 * 60; m += 30) {
    const startLabel = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    const endLabel = `${pad(Math.floor((m + 30) / 60))}:${pad((m + 30) % 60)}`;
    timeLabels.push(`${startLabel}–${endLabel}`);
    minutes.push(m);
  }

  const days: SummaryDay[] = thisWeekWeekdays().map(({ ymd, label }) => {
    const cells: SummaryCell[] = minutes.map((m, idx) => {
      const startMs = new Date(
        `${ymd}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00+09:00`,
      ).getTime();
      const endMs = startMs + 30 * 60000;

      // この30分に「予定が重ならない人」の数を数える
      const freePeople = peopleBusy.filter(
        (intervals) => !intervals.some((b) => startMs < b.end && b.start < endMs),
      ).length;
      // 会議室がこの30分に予約済みか
      const isRoomBusy = roomBusy.some((b) => startMs < b.end && b.start < endMs);

      return { timeLabel: timeLabels[idx], freePeople, roomBusy: isRoomBusy };
    });
    return { label, cells };
  });

  return { timeLabels, days, totalPeople: peopleBusy.length };
}