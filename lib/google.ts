const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type CalendarEvent = {
  id: string;
  summary?: string;
  status?: string;        // "confirmed" | "tentative" | "cancelled"
  transparency?: string;  // "opaque"(=予定あり) | "transparent"(=空きとして扱う)
  eventType?: string;     // "default" | "outOfOffice" | "focusTime" など
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

// 単一カレンダーの予定を取得（calendarId を指定できる汎用版）
export async function listEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });

  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Calendar API error ${res.status} (${calendarId}): ${body}`);
  }

  const data = await res.json();
  return (data.items ?? []) as CalendarEvent[];
}

// 対象ごとの取得結果（1人でも失敗しても全体は止めない）
export type TargetEvents = {
  name: string;
  calendarId: string;
  events: CalendarEvent[];
  error?: string;
};

// 複数の対象（人＋会議室）をまとめて取得
export async function listEventsForTargets(
  accessToken: string,
  targets: { name: string; calendarId: string }[],
  timeMin: string,
  timeMax: string,
): Promise<TargetEvents[]> {
  return Promise.all(
    targets.map(async (t) => {
      try {
        const events = await listEvents(accessToken, t.calendarId, timeMin, timeMax);
        return { name: t.name, calendarId: t.calendarId, events };
      } catch (e) {
        // 権限が無い等で失敗したら error に記録（他の人の取得は続行）
        return {
          name: t.name,
          calendarId: t.calendarId,
          events: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
}