import type { TargetEvents, CalendarEvent } from "./google";
import { classifyByMachineSignals } from "./classify";

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
export function busyIntervalsOf(events: CalendarEvent[]): { start: number; end: number }[] {
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

// 会議室用: 時刻あり予定＋終日予定（終日ぶん占有）を busy として返す
export function roomBusyIntervals(
  events: CalendarEvent[],
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    if (ev.transparency === "transparent") continue;
    if (ev.start?.dateTime && ev.end?.dateTime) {
      out.push({
        start: new Date(ev.start.dateTime).getTime(),
        end: new Date(ev.end.dateTime).getTime(),
      });
    } else if (ev.start?.date && ev.end?.date) {
      // 終日予約は終日ぶん占有扱い（会議室を終日押さえている）
      out.push({
        start: new Date(`${ev.start.date}T00:00:00+09:00`).getTime(),
        end: new Date(`${ev.end.date}T00:00:00+09:00`).getTime(),
      });
    }
  }
  return out;
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
  const offsetToMonday = ((dow[wd] ?? 1) + 6) % 7; // 月曜まで何日戻るか
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

// 今日(JST)起点で土日を除く平日を並べ、offsetページ目(count日ずつ)を返す
// 例: offset=0 → 今日からの平日5日 / offset=1 → その次の平日5日
export function businessDaysPage(
  offset: number,
  count = 5,
): { ymd: string; label: string }[] {
  const base = new Date(`${todayYmdJst()}T00:00:00+09:00`).getTime();
  const need = (offset + 1) * count; // 先頭からこの数だけ平日を集める
  const days: { ymd: string; label: string }[] = [];
  let i = 0;
  while (days.length < need && i < 400) {
    const d = new Date(base + i * 86400000);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
    }).format(d);
    if (weekday !== "Sat" && weekday !== "Sun") {
      days.push({
        ymd: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d),
        label: d.toLocaleDateString("ja-JP", {
          timeZone: "Asia/Tokyo",
          month: "numeric",
          day: "numeric",
          weekday: "short",
        }),
      });
    }
    i++;
  }
  return days.slice(offset * count, offset * count + count);
}

// 今日(JST)起点で土日を除いた offset 番目(0始まり)の平日を返す
export function businessDay(offset: number): { ymd: string; label: string } {
  const base = new Date(`${todayYmdJst()}T00:00:00+09:00`).getTime();
  let count = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(base + i * 86400000);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
    }).format(d);
    if (weekday === "Sat" || weekday === "Sun") continue;
    if (count === offset) {
      return {
        ymd: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d),
        label: d.toLocaleDateString("ja-JP", {
          timeZone: "Asia/Tokyo",
          month: "numeric",
          day: "numeric",
          weekday: "short",
        }),
      };
    }
    count++;
  }
  return { ymd: todayYmdJst(), label: "" }; // フォールバック（通常到達しない）
}

// 週サマリーを組み立てる（人の空き濃淡＋会議室占有）。表示する平日リストを受け取る
export function buildWeekSummary(
  targets: TargetEvents[],
  roomCalendarId: string,
  daysInput: { ymd: string; label: string }[],
): WeekSummary {
  // 人と会議室を分ける
  const peopleBusy = targets
    .filter((t) => t.calendarId !== roomCalendarId)
    .map((t) => busyIntervalsOf(t.events));
  const room = targets.find((t) => t.calendarId === roomCalendarId);
  const roomBusy = room ? roomBusyIntervals(room.events) : []; // 終日予約も占有扱い

  // 時間行（9:00〜18:00 の 30分刻み）。ラベルは「開始–終了」の範囲表記
  const timeLabels: string[] = [];
  const minutes: number[] = [];
  for (let m = 9 * 60; m < 18 * 60; m += 30) {
    const startLabel = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    const endLabel = `${pad(Math.floor((m + 30) / 60))}:${pad((m + 30) % 60)}`;
    timeLabels.push(`${startLabel}–${endLabel}`);
    minutes.push(m);
  }

  const days: SummaryDay[] = daysInput.map(({ ymd, label }) => {
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

      return { timeLabel: timeLabels[idx] ?? "", freePeople, roomBusy: isRoomBusy };
    });
    return { label, cells };
  });

  return { timeLabels, days, totalPeople: peopleBusy.length };
}

// ===== メンバー別ヒートマップ（1日分・9:00–18:00 の30分帯）=====

export type MemberSlotState = "free" | "soft" | "hard"; // 空 / オレンジ / 赤
export type MemberHeatmap = {
  name: string;
  cells: MemberSlotState[]; // 9:00–18:00 の30分 ×18
};

// 機械シグナル＋fix prefix のみで「動かせない(hard)／その他予定(soft)／空(free)」に寄せる（AIは使わない）
function memberCellCategory(ev: CalendarEvent): MemberSlotState {
  const c = classifyByMachineSignals(ev);
  if (c === "free") return "free";
  if (c === "hard") return "hard";
  return "soft"; // soft / tentative / allday_block / ambiguous はすべて「その他予定」
}

// 指定日(ymd)の各メンバーについて、9:00–18:00 を30分刻みで色分けした帯を返す
export function buildMemberDayHeatmaps(
  peopleTargets: TargetEvents[],
  ymd: string,
): MemberHeatmap[] {
  const slotStarts: number[] = [];
  for (let m = 9 * 60; m < 18 * 60; m += 30) {
    slotStarts.push(
      new Date(`${ymd}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00+09:00`).getTime(),
    );
  }
  const dayStart = new Date(`${ymd}T00:00:00+09:00`).getTime();
  const dayEnd = dayStart + 86400000;

  return peopleTargets.map((t) => {
    const hard: { start: number; end: number }[] = [];
    const soft: { start: number; end: number }[] = [];
    for (const ev of t.events) {
      const cat = memberCellCategory(ev);
      if (cat === "free") continue;
      let s: number, e: number;
      if (ev.start?.dateTime && ev.end?.dateTime) {
        s = new Date(ev.start.dateTime).getTime();
        e = new Date(ev.end.dateTime).getTime();
      } else if (ev.start?.date && ev.end?.date) {
        s = new Date(`${ev.start.date}T00:00:00+09:00`).getTime();
        e = new Date(`${ev.end.date}T00:00:00+09:00`).getTime(); // 終日 → その日全体
      } else {
        continue;
      }
      if (e <= dayStart || s >= dayEnd) continue; // 当日に重ならない
      (cat === "hard" ? hard : soft).push({ start: s, end: e });
    }
    const cells: MemberSlotState[] = slotStarts.map((st) => {
      const en = st + 30 * 60000;
      if (hard.some((b) => st < b.end && b.start < en)) return "hard";
      if (soft.some((b) => st < b.end && b.start < en)) return "soft";
      return "free";
    });
    return { name: t.name, cells };
  });
}

// ===== M4: 候補スロット算出 =====

export type CandidateSlot = { start: string; end: string; roomAvailable: boolean };

// 参加者（人）が全員空く枠を、指定期間（from〜to）・近い順で算出。会議室の空きはフラグで付与
export function findCandidateSlots(
  peopleTargets: TargetEvents[],
  roomTarget: TargetEvents | undefined,
  durationMinutes: number,
  range: { from: string; to: string },
  stepMinutes = 30,
): CandidateSlot[] {
  const peopleBusy = peopleTargets.map((t) => busyIntervalsOf(t.events));
  const roomBusy = roomTarget ? busyIntervalsOf(roomTarget.events) : [];

  const slots: CandidateSlot[] = [];
  const fromMs = new Date(`${range.from}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${range.to}T00:00:00+09:00`).getTime();

  for (let dayMs = fromMs; dayMs <= toMs; dayMs += 86400000) {
    const d = new Date(dayMs);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
    }).format(d);
    if (weekday === "Sat" || weekday === "Sun") continue;

    const lastStartMinute = BUSINESS_END_HOUR * 60 - durationMinutes;
    for (let m = BUSINESS_START_HOUR * 60; m <= lastStartMinute; m += stepMinutes) {
      const startIso = `${ymd}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00+09:00`;
      const startMs = new Date(startIso).getTime();
      const endMs = startMs + durationMinutes * 60000;

      // 参加者全員が空いているか（人単位で重なりチェック）
      const everyoneFree = peopleBusy.every(
        (intervals) => !intervals.some((b) => startMs < b.end && b.start < endMs),
      );
      if (!everyoneFree) continue;

      const endMin = m + durationMinutes;
      const endIso = `${ymd}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00+09:00`;
      const roomAvailable = !roomBusy.some((b) => startMs < b.end && b.start < endMs);
      slots.push({ start: startIso, end: endIso, roomAvailable });
    }
  }
  return slots; // 既に開始時刻の昇順＝近い順
}

// ===== M6: 分類済み参加者から候補スロット（hard=除外, soft=注釈）=====

export type CandidateSlotEx = {
  start: string;
  end: string;
  roomAvailable: boolean;
  adjustable: boolean; // hardは無いがsoft/tentativeが重なる
  softConflicts: string[]; // soft/tentativeを持つ人の名前
};

export function findCandidateSlotsCategorized(
  people: {
    name: string;
    hard: { start: number; end: number }[];
    soft: { start: number; end: number }[];
  }[],
  roomBusy: { start: number; end: number }[],
  durationMinutes: number,
  range: { from: string; to: string },
  stepMinutes = 30,
): CandidateSlotEx[] {
  const out: CandidateSlotEx[] = [];
  const fromMs = new Date(`${range.from}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${range.to}T00:00:00+09:00`).getTime();

  for (let dayMs = fromMs; dayMs <= toMs; dayMs += 86400000) {
    const d = new Date(dayMs);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
    }).format(d);
    if (weekday === "Sat" || weekday === "Sun") continue;

    const lastStartMinute = BUSINESS_END_HOUR * 60 - durationMinutes;
    for (let m = BUSINESS_START_HOUR * 60; m <= lastStartMinute; m += stepMinutes) {
      const startIso = `${ymd}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00+09:00`;
      const startMs = new Date(startIso).getTime();
      const endMs = startMs + durationMinutes * 60000;
      const hits = (iv: { start: number; end: number }[]) =>
        iv.some((b) => startMs < b.end && b.start < endMs);

      if (people.some((p) => hits(p.hard))) continue; // hardで埋まってたら除外

      const softConflicts = people.filter((p) => hits(p.soft)).map((p) => p.name);
      const endMin = m + durationMinutes;
      const endIso = `${ymd}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00+09:00`;
      out.push({
        start: startIso,
        end: endIso,
        roomAvailable: !hits(roomBusy),
        adjustable: softConflicts.length > 0,
        softConflicts,
      });
    }
  }
  return out;
}

// ===== M6-C: 会議室の付け忘れ検出 =====

export type RoomForgotten = { name: string; start: string; end: string };

// 「会議」タイトルなのに会議室が予約されていない予定を検出（今週・全員分）
export function detectRoomForgotten(
  targets: TargetEvents[],
  roomCalendarId: string,
): RoomForgotten[] {
  const room = targets.find((t) => t.calendarId === roomCalendarId);
  const roomBusy = busyIntervalsOf(room?.events ?? []);

  // 今週（月〜金）の範囲
  const week = thisWeekWeekdays();
  const first = week[0];
  const last = week[week.length - 1];
  if (!first || !last) return [];
  const fromMs = new Date(`${first.ymd}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${last.ymd}T23:59:59+09:00`).getTime();

  const out: RoomForgotten[] = [];
  for (const t of targets) {
    if (t.calendarId === roomCalendarId) continue; // 会議室自身は対象外
    for (const ev of t.events) {
      if (ev.status === "cancelled") continue;
      if (!ev.summary?.includes("会議")) continue; // タイトルに「会議」
      const s = ev.start?.dateTime;
      const e = ev.end?.dateTime;
      if (!s || !e) continue; // 終日は対象外
      const startMs = new Date(s).getTime();
      const endMs = new Date(e).getTime();
      if (startMs < fromMs || startMs > toMs) continue; // 今週のみ

      // この時間に会議室が予約されているか
      const roomBooked = roomBusy.some((b) => startMs < b.end && b.start < endMs);
      if (!roomBooked) out.push({ name: t.name, start: s, end: e });
    }
  }
  return out;
}

// ===== 会議室の直近の利用予定 =====

export type RoomUsage = {
  start: string;
  end: string;
  allDay: boolean;
  organizerEmail?: string;
  organizerName?: string;
  tentative: boolean;
};

// 会議室カレンダーから「終了が未来」の予定を開始順に最大 limit 件
export function listRoomUsage(events: CalendarEvent[], limit = 5): RoomUsage[] {
  const nowMs = Date.now();
  return events
    .filter((ev) => ev.status !== "cancelled")
    .map((ev) => {
      const timed = !!(ev.start?.dateTime && ev.end?.dateTime);
      const start = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00+09:00` : "");
      const end = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00+09:00` : "");
      return {
        start,
        end,
        allDay: !timed,
        organizerEmail: ev.organizer?.email,
        organizerName: ev.organizer?.displayName,
        tentative: ev.status === "tentative",
      };
    })
    .filter((u) => u.start && u.end && new Date(u.end).getTime() >= nowMs)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, limit);
}