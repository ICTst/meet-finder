const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type CalendarEvent = {
  id: string;
  summary?: string;
  status?: string;        // "confirmed" | "tentative" | "cancelled"
  transparency?: string;  // "opaque"(=予定あり) | "transparent"(=空きとして扱う)
  eventType?: string;     // "default" | "outOfOffice" | "focusTime" など
  organizer?: { email?: string; displayName?: string }; // 予約者
  creator?: { email?: string; displayName?: string };
  // 参加者（自分=self:true / 会議室などのリソース=resource:true）
  attendees?: { email?: string; self?: boolean; resource?: boolean; responseStatus?: string }[];
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

// ===== M5: 確定直前の再確認 & 予定作成 =====

export type FreeBusyResult = { allFree: boolean; busyBy: string[] };

// 対象カレンダー群が、指定スロットで全員空いているか再確認
export async function checkFreeBusy(
  accessToken: string,
  calendarIds: string[],
  timeMin: string,
  timeMax: string,
): Promise<FreeBusyResult> {
  const res = await fetch(`${CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: calendarIds.map((id) => ({ id })),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`FreeBusy error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const busyBy: string[] = [];
  for (const id of calendarIds) {
    const busy = data.calendars?.[id]?.busy ?? [];
    if (busy.length > 0) busyBy.push(id);
  }
  return { allFree: busyBy.length === 0, busyBy };
}

// 予定を作成（自分のprimaryに、参加者＋会議室をattendeeで。通知なし）
export async function insertEvent(
  accessToken: string,
  params: { summary: string; start: string; end: string; attendees: string[] },
): Promise<{ id: string; htmlLink: string }> {
  const res = await fetch(
    `${CALENDAR_API}/calendars/primary/events?sendUpdates=none`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        summary: params.summary,
        start: { dateTime: params.start, timeZone: "Asia/Tokyo" },
        end: { dateTime: params.end, timeZone: "Asia/Tokyo" },
        attendees: params.attendees.map((email) => ({ email })),
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`events.insert error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return { id: data.id, htmlLink: data.htmlLink };
}