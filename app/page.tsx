import { auth, signIn, signOut } from "@/auth";
import { listEventsForTargets } from "@/lib/google";
import { buildTargets, ROOM, PEOPLE, resolveParticipants, type Person } from "@/lib/people";
import {
  buildWeekSummary,
  findCandidateSlotsCategorized,
  roomBusyIntervals,
  listRoomUsage,
  type SummaryCell,
  type CandidateSlotEx,
  type RoomUsage,
} from "@/lib/availability";
import { categorizeTargets } from "@/lib/categorize";
import { parseMeetingRequest, addReasons } from "@/lib/ai";
import type { MeetingRequest, Candidate } from "@/lib/schemas";
import { SearchForm } from "./search-form";
import { BookButton } from "./book-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// 空いている人数の割合 → セルの背景色
function cellColor(free: number, total: number): string {
  if (total === 0) return "bg-zinc-50";
  const ratio = free / total;
  if (ratio === 1) return "bg-green-600 text-white"; // 全員空き
  if (ratio >= 0.5) return "bg-green-300";
  if (ratio > 0) return "bg-green-100";
  return "bg-zinc-100 text-zinc-400"; // 全員埋まり
}

function fmtRange(start: string, end: string): string {
  const s = new Date(start).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const e = new Date(end).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${s}〜${e}`;
}

// 会議室利用1件の日時表記（終日は「終日」）
function fmtUsage(u: RoomUsage): string {
  if (u.allDay) {
    return (
      new Date(u.start).toLocaleDateString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        weekday: "short",
      }) + " 終日"
    );
  }
  return fmtRange(u.start, u.end);
}

// 予約者を既知メンバー名に解決（無ければGoogleの表示名/メール）
function roomUserLabel(u: RoomUsage): string {
  const hit = PEOPLE.find((p) => p.email === u.organizerEmail);
  return hit?.name ?? u.organizerName ?? u.organizerEmail ?? "不明";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth();

  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6">
        <h1 className="text-3xl font-semibold">MeetFinder</h1>
        <p className="text-sm text-muted-foreground">
          AIで会議の空き枠を見つけてワンタップ予約
        </p>
        <form action={async () => { "use server"; await signIn("google"); }}>
          <Button type="submit" size="lg">Googleでログイン</Button>
        </form>
      </main>
    );
  }

  if (session.error === "RefreshTokenError" || !session.accessToken) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">
          セッションの有効期限が切れました。再ログインしてください。
        </p>
        <form action={async () => { "use server"; await signIn("google"); }}>
          <Button type="submit">再ログイン</Button>
        </form>
      </main>
    );
  }

  // 入力された一文をパース（?q= で渡ってくる）
  const { q } = await searchParams;
  let parsed:
    | { request: MeetingRequest; matched: Person[]; unmatched: string[] }
    | null = null;
  if (q) {
    const request = await parseMeetingRequest(q);
    const { matched, unmatched } = resolveParticipants(request.participants);
    parsed = { request, matched, unmatched };
  }

  // 解析できたら候補を計算（参加者＋会議室の予定を取得 → 分類 → 近い順 → AIで根拠付け）
  let candidates: Candidate[] | null = null;
  let adjustable: CandidateSlotEx[] = [];
  if (parsed && parsed.matched.length > 0) {
    const targets = [
      ...parsed.matched.map((p) => ({ name: p.name, calendarId: p.email })),
      { name: ROOM.name, calendarId: ROOM.calendarId },
    ];
    const events = await listEventsForTargets(
      session.accessToken,
      targets,
      `${parsed.request.dateRange.from}T00:00:00+09:00`,
      `${parsed.request.dateRange.to}T23:59:59+09:00`,
    );
    const peopleTargets = events.filter((e) => e.calendarId !== ROOM.calendarId);
    const roomTarget = events.find((e) => e.calendarId === ROOM.calendarId);

    // 機械＋AIで分類してから候補算出
    const categorized = await categorizeTargets(peopleTargets);
    const roomBusy = roomBusyIntervals(roomTarget?.events ?? []);
    const exSlots = findCandidateSlotsCategorized(
      categorized,
      roomBusy,
      parsed.request.durationMinutes,
      parsed.request.dateRange,
    );

    const cleanSlots = exSlots.filter((s) => !s.adjustable).slice(0, 8);
    adjustable = exSlots.filter((s) => s.adjustable).slice(0, 6);

    const reasons = await addReasons(
      cleanSlots.map((s) => ({ start: s.start, end: s.end, roomAvailable: s.roomAvailable })),
    );
    candidates = cleanSlots.map((s, i) => ({
      start: s.start,
      end: s.end,
      score: 100 - i, // 近い順 → 先頭が高スコア（暫定）
      roomAvailable: s.roomAvailable,
      reason: reasons[i]?.reason ?? "",
      warnings: reasons[i]?.warnings ?? [],
    }));
  }

  // 予約に渡す情報（参加者のメール＋会議室ID、タイトルは「会議：…」）
  const bookingAttendees = parsed
    ? [...parsed.matched.map((p) => p.email), ROOM.calendarId]
    : [];
  const bookingSummary = parsed
    ? `会議：${parsed.matched.map((p) => p.name).join("、")}`
    : "";

  // 今週を含む2週間分を取得（サマリーは今週分だけ使う）
  const now = new Date();
  const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const results = await listEventsForTargets(
    session.accessToken,
    buildTargets(),
    now.toISOString(),
    twoWeeksLater.toISOString(),
  );

  const summary = buildWeekSummary(results, ROOM.calendarId);
  const roomUsage = listRoomUsage(
    results.find((r) => r.calendarId === ROOM.calendarId)?.events ?? [],
  );

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">MeetFinder</h1>
        <div className="flex items-center gap-3">
          <a
            href="https://calendar.google.com/calendar/"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Googleカレンダー ↗
          </a>
          <form action={async () => { "use server"; await signOut(); }}>
            <Button type="submit" variant="outline" size="sm">ログアウト</Button>
          </form>
        </div>
      </div>

      {/* 一文で依頼を入力（解析中はローディング表示） */}
      <SearchForm initialQ={q ?? ""} />

      {parsed && (
        <Card className="mb-6">
          <CardContent>
            「{q}」を解析しました。{" "}
            参加者:{" "}
            <span className="font-medium">
              {parsed.matched.map((m) => m.name).join("・") || "なし"}
            </span>
            {parsed.unmatched.length > 0 && (
              <span className="text-destructive">
                （未解決: {parsed.unmatched.join("・")}）
              </span>
            )}
            {" ／ "}
            {parsed.request.durationMinutes}分 ／ {parsed.request.dateRange.from}〜
            {parsed.request.dateRange.to}
          </CardContent>
        </Card>
      )}

      {candidates && (
        <div className="mb-6">
          <h2 className="mb-2 font-medium">候補（近い順）</h2>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              条件に合う空き枠が見つかりませんでした。
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {candidates.map((c) => (
                <Card key={c.start} className="gap-2">
                  <CardContent className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{fmtRange(c.start, c.end)}</span>
                      <Badge variant={c.roomAvailable ? "secondary" : "destructive"}>
                        {c.roomAvailable ? "会議室 空き" : "会議室 埋"}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">{c.reason}</p>
                    {c.warnings.length > 0 && (
                      <ul className="list-disc pl-5 text-xs text-amber-600">
                        {c.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    )}
                    <BookButton
                      start={c.start}
                      end={c.end}
                      summary={bookingSummary}
                      attendees={bookingAttendees}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {adjustable.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 font-medium text-muted-foreground">
            調整すれば可能な枠（参考）
          </h2>
          <div className="flex flex-col gap-2">
            {adjustable.map((s) => (
              <Card key={s.start} className="bg-muted/30">
                <CardContent className="flex flex-col gap-1">
                  <span className="font-medium">{fmtRange(s.start, s.end)}</span>
                  <p className="text-xs text-amber-600">
                    {s.softConflicts.join("・")} がタスク枠／仮予定（調整できるかも）
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {roomUsage.length > 0 && (
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm font-medium">会議室の利用予定（直近）</p>
            <ul className="flex flex-col gap-1.5 text-sm">
              {roomUsage.map((u, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground whitespace-nowrap">
                    {fmtUsage(u)}
                  </span>
                  <span className="font-medium">{roomUserLabel(u)}</span>
                  {u.tentative && <Badge variant="outline">仮</Badge>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            今週の空きサマリー ／ 対象: {PEOPLE.map((p) => p.name).join("・")}（
            {summary.totalPeople}人）＋ {ROOM.name}
          </p>

          <div className="overflow-x-auto">
            <table className="border-collapse text-center text-xs">
              <thead>
                <tr>
                  <th className="p-1"></th>
                  {summary.days.map((d) => (
                    <th key={d.label} className="p-1 font-medium whitespace-nowrap">
                      {d.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.timeLabels.map((time, rowIdx) => (
                  <tr key={time}>
                    <td className="pr-2 text-right text-muted-foreground whitespace-nowrap">
                      {time}
                    </td>
                    {summary.days.map((d) => {
                      const c: SummaryCell = d.cells[rowIdx];
                      return (
                        <td
                          key={d.label + time}
                          title={`${d.label} ${time} / 空き ${c.freePeople}人${c.roomBusy ? " / 会議室予約あり" : ""}`}
                          className={[
                            "h-6 w-14 border border-white",
                            cellColor(c.freePeople, summary.totalPeople),
                            c.roomBusy ? "ring-2 ring-red-500 ring-inset" : "",
                          ].join(" ")}
                        >
                          {c.freePeople}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 凡例 */}
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-4 w-4 bg-green-600" /> 全員空き
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-4 w-4 bg-green-300" /> 半数以上空き
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-4 w-4 bg-green-100" /> 一部空き
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-4 w-4 bg-zinc-100" /> 全員埋まり
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-4 w-4 ring-2 ring-red-500 ring-inset" /> 会議室 予約済み
            </span>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
