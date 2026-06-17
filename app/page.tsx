import { auth, signIn, signOut } from "@/auth";
import { listEventsForTargets } from "@/lib/google";
import { buildTargets, ROOM, PEOPLE, resolveParticipants, type Person } from "@/lib/people";
import {
  buildWeekSummary,
  businessDaysPage,
  businessDay,
  buildMemberDayHeatmaps,
  findCandidateSlotsCategorized,
  roomBusyIntervals,
  type SummaryCell,
  type MemberSlotState,
} from "@/lib/availability";
import { categorizeTargets } from "@/lib/categorize";
import { parseMeetingRequest } from "@/lib/ai";
import type { MeetingRequest } from "@/lib/schemas";
import { SearchForm } from "./search-form";
import { CandidateList, type CandidateRow } from "./candidate-list";
import { Avatar } from "./avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";

// 週サマリーのページ送り上限（0..MAX_WO ＝ 今日から平日 (MAX_WO+1)*5 日先まで）
const MAX_WO = 3;
// メンバー予定の日送り上限（今日起点の平日オフセット）
const MEMBER_MAX_MD = (MAX_WO + 1) * 5 - 1;

// ナビ用URL（q / wo / md を保持。未指定の項目は付けない）
function hrefWith(p: { q?: string; wo?: number; md?: number }): string {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.wo && p.wo > 0) sp.set("wo", String(p.wo));
  if (p.md != null && p.md > 0) sp.set("md", String(p.md));
  const s = sp.toString();
  return s ? `/?${s}` : "/";
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

// メンバーヒートマップ1セルの色（赤=動かせない / オレンジ=その他予定 / 灰=空き）
function memberCellColor(s: MemberSlotState): string {
  if (s === "hard") return "bg-red-400";
  if (s === "soft") return "bg-orange-300";
  return "bg-zinc-200";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; wo?: string; md?: string }>;
}) {
  // auth.ts の async session(...) によって UI側で...
  // const session = await auth();
  // session.accessToken // ← これが使える
  // session.error       // ← これが使える
  const session = await auth();

  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6">
        <h1 className="text-3xl font-semibold">みんなの日程調整くん</h1>
        <p className="text-sm text-muted-foreground">
          AIで会議の空き枠を見つけてワンタップ予約
        </p>
        <form action={async () => { "use server"; await signIn("google"); }}>
          <Button type="submit" size="lg">Googleでログイン</Button>
        </form>
      </main>
    );
  }
  // auth.tsにて / token.errorおよび、session.errorの箱はあるが、エラーが起きるまではundefined
  // エラー時に、catchの中で、token.errorにRefreshTokenErrorが入り、session.errorに引き継がれる
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

  // 入力された一文をパース（?q= で渡ってくる）。?wo=週送り / ?md=メンバー予定の日送り
  const { q, wo: woRaw, md: mdRaw } = await searchParams;
  const wo = Math.min(MAX_WO, Math.max(0, Number.parseInt(woRaw ?? "0", 10) || 0));
  // md 未指定なら表示窓の先頭日（wo*5）＝5営業日ナビと連動。指定があればその日
  const md = Math.min(
    MEMBER_MAX_MD,
    Math.max(0, mdRaw != null ? Number.parseInt(mdRaw, 10) || 0 : wo * 5),
  );
  let parsed:
    | { request: MeetingRequest; matched: Person[]; unmatched: string[] }
    | null = null;
  if (q) {
    const request = await parseMeetingRequest(q);
    const { matched, unmatched } = resolveParticipants(request.participants);
    parsed = { request, matched, unmatched };
  }

  // 解析できたら候補を計算（参加者＋会議室の予定を取得 → 分類 → 近い順 → AIで根拠付け）
  let candidateRows: CandidateRow[] | null = null;
  if (parsed && parsed.matched.length > 0) {
    // 候補計算には「自分（ログイン本人）」も必ず含める
    const selfEmail = session.user?.email;
    const calcPeople = [...parsed.matched];
    if (selfEmail && !calcPeople.some((p) => p.email === selfEmail)) {
      calcPeople.push(
        PEOPLE.find((p) => p.email === selfEmail) ?? { name: "自分", email: selfEmail },
      );
    }

    const targets = [
      ...calcPeople.map((p) => ({ name: p.name, calendarId: p.email })),
      { name: ROOM.name, calendarId: ROOM.calendarId },
    ];
    // 具体的なaccessTokenの中身(ya29.xxx...のような文字列)はここでチェックされている
    const events = await listEventsForTargets(
      session.accessToken,
      targets,
      `${parsed.request.dateRange.from}T00:00:00+09:00`,
      `${parsed.request.dateRange.to}T23:59:59+09:00`,
    );
    const peopleTargets = events.filter((e) => e.calendarId !== ROOM.calendarId);
    const roomTarget = events.find((e) => e.calendarId === ROOM.calendarId);

    // 機械＋AIで分類してから候補算出（hardは除外、softは「要調整」で残す）
    const categorized = await categorizeTargets(peopleTargets);
    const roomBusy = roomBusyIntervals(roomTarget?.events ?? []);
    const exSlots = findCandidateSlotsCategorized(
      categorized,
      roomBusy,
      parsed.request.durationMinutes,
      parsed.request.dateRange,
    );

    // 空き(緑)も要調整(オレンジ)も近い順で1リストに統合（上位6件）
    const topSlots = exSlots.slice(0, 6);
    candidateRows = topSlots.map((s) => ({
      start: s.start,
      end: s.end,
      label: fmtRange(s.start, s.end),
      roomAvailable: s.roomAvailable,
      adjustable: s.adjustable,
      softConflicts: s.softConflicts,
    }));
  }

  // 予約に渡す情報（参加者のメール。会議室は候補ごとに付け外しするのでここには含めない）
  const peopleAttendees = parsed ? parsed.matched.map((p) => p.email) : [];
  const bookingSummary = parsed
    ? `会議：${parsed.matched.map((p) => p.name).join("、")}`
    : "";

  // 表示する平日5日（今日起点・wo ページ目）＋ メンバー一覧の表示日（md 番目の平日）
  const days = businessDaysPage(wo);
  const memberDay = businessDay(md);
  const now = new Date();
  const windowStartMs = new Date(`${days[0].ymd}T00:00:00+09:00`).getTime();
  const windowEndMs = new Date(`${days[days.length - 1].ymd}T23:59:59+09:00`).getTime();
  const memberDayStartMs = new Date(`${memberDay.ymd}T00:00:00+09:00`).getTime();
  const memberDayEndMs = new Date(`${memberDay.ymd}T23:59:59+09:00`).getTime();
  // サマリー窓・メンバー表示日・直近2週間、すべてを1回の取得でまかなう
  const fetchMinMs = Math.min(windowStartMs, memberDayStartMs, now.getTime());
  const fetchMaxMs = Math.max(
    windowEndMs,
    memberDayEndMs,
    now.getTime() + 14 * 24 * 60 * 60 * 1000,
  );
  const results = await listEventsForTargets(
    session.accessToken,
    buildTargets(),
    new Date(fetchMinMs).toISOString(),
    new Date(fetchMaxMs).toISOString(),
  );

  const summary = buildWeekSummary(results, ROOM.calendarId, days);
  // メンバー一覧ヒートマップ（memberDay の1日分）
  const memberHeatmaps = buildMemberDayHeatmaps(
    results.filter((r) => r.calendarId !== ROOM.calendarId),
    memberDay.ymd,
  );

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">みんなの日程調整くん</h1>
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
            <Button type="submit" className="cursor-pointer" variant="outline" size="sm">ログアウト</Button>
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

      {candidateRows && (
        <div className="mb-6">
          <h2 className="mb-2 font-medium">候補（近い順）</h2>
          {candidateRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              条件に合う空き枠が見つかりませんでした。
            </p>
          ) : (
            <CandidateList
              rows={candidateRows}
              peopleAttendees={peopleAttendees}
              roomCalendarId={ROOM.calendarId}
              defaultSummary={bookingSummary}
            />
          )}
        </div>
      )}

      {/* メンバーの予定 と 会議室の空き状況を横並び（狭い画面では縦積み） */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* メンバーの予定（先頭日の1日分・9:00–18:00 のヒートマップ帯） */}
        <Card className="lg:flex-1 lg:min-w-0">
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                メンバーの予定（{memberDay.label} 9:00–18:00）
              </p>
              <div className="flex items-center gap-2">
                {md > 0 ? (
                  <Link href={hrefWith({ q, wo, md: md - 1 })}>
                    <Button type="button" variant="outline" size="sm">
                      ← 前日
                    </Button>
                  </Link>
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled>
                    ← 前日
                  </Button>
                )}
                {md < MEMBER_MAX_MD ? (
                  <Link href={hrefWith({ q, wo, md: md + 1 })}>
                    <Button type="button" variant="outline" size="sm">
                      翌日 →
                    </Button>
                  </Link>
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled>
                    翌日 →
                  </Button>
                )}
              </div>
            </div>

            {/* 時刻の目盛り（9〜18時） */}
            <div className="flex items-center gap-3">
              <div className="w-28 shrink-0" />
              <div className="flex flex-1 justify-between text-[10px] text-muted-foreground">
                {[9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((h) => (
                  <span key={h}>{h}</span>
                ))}
              </div>
            </div>

            {/* メンバー行（左=アイコン＋名前 / 右=ヒートマップ帯） */}
            <div className="flex flex-col">
              {memberHeatmaps.map((m) => (
                <div
                  key={m.name}
                  className="flex items-center gap-3 border-b py-1.5 last:border-b-0"
                >
                  <div className="flex w-28 shrink-0 items-center gap-2">
                    <Avatar
                      src={PEOPLE.find((p) => p.name === m.name)?.image}
                      name={m.name}
                    />
                    <span className="truncate text-sm">{m.name}</span>
                  </div>
                  <div className="flex flex-1 gap-px overflow-hidden rounded">
                    {m.cells.map((s, i) => (
                      <div
                        key={i}
                        title={`${m.name} ${9 + Math.floor(i / 2)}:${i % 2 === 0 ? "00" : "30"} ${
                          s === "hard" ? "動かせない予定" : s === "soft" ? "予定あり" : "空き"
                        }`}
                        className={["h-5 flex-1", memberCellColor(s)].join(" ")}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* 凡例 */}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block h-4 w-4 bg-red-400" /> 動かせない（会議・fix）
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-4 w-4 bg-orange-300" /> その他予定
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-4 w-4 bg-zinc-200" /> 空き
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:flex-1 lg:min-w-0">
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                会議室の空き状況（平日 9:00–18:00）
              </p>
              <div className="flex items-center gap-2">
                {wo > 0 ? (
                  <Link href={hrefWith({ q, wo: wo - 1 })}>
                    <Button type="button" variant="outline" size="sm">
                      ← 前の5営業日
                    </Button>
                  </Link>
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled>
                    ← 前の5営業日
                  </Button>
                )}
                {wo < MAX_WO ? (
                  <Link href={hrefWith({ q, wo: wo + 1 })}>
                    <Button type="button" variant="outline" size="sm">
                      次の5営業日 →
                    </Button>
                  </Link>
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled>
                    次の5営業日 →
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {summary.days[0]?.label} 〜 {summary.days[summary.days.length - 1]?.label}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-center text-xs">
                <thead>
                  <tr>
                    <th className="w-24 p-1"></th>
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
                            title={`${d.label} ${time} / 会議室 ${c.roomBusy ? "予約済み" : "空き"}`}
                            className={[
                              "h-8 border border-white",
                              c.roomBusy ? "bg-red-400" : "bg-zinc-200",
                            ].join(" ")}
                          ></td>
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
                <span className="inline-block h-4 w-4 bg-zinc-200" /> 空き
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-4 w-4 bg-red-400" /> 予約済み
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
