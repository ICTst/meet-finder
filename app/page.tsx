import { auth, signIn, signOut } from "@/auth";
import { listEventsForTargets } from "@/lib/google";
import { buildTargets, ROOM, PEOPLE, resolveParticipants, type Person } from "@/lib/people";
import { buildWeekSummary, type SummaryCell } from "@/lib/availability";
import { parseMeetingRequest } from "@/lib/ai";
import type { MeetingRequest } from "@/lib/schemas";

// 空いている人数の割合 → セルの背景色
function cellColor(free: number, total: number): string {
  if (total === 0) return "bg-zinc-50";
  const ratio = free / total;
  if (ratio === 1) return "bg-green-600 text-white"; // 全員空き
  if (ratio >= 0.5) return "bg-green-300";
  if (ratio > 0) return "bg-green-100";
  return "bg-zinc-100 text-zinc-400"; // 全員埋まり
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth();

  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">MeetFinder</h1>
        <form action={async () => { "use server"; await signIn("google"); }}>
          <button className="rounded-full bg-black px-6 py-3 text-white cursor-pointer">
            Googleでログイン
          </button>
        </form>
      </main>
    );
  }

  if (session.error === "RefreshTokenError" || !session.accessToken) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p>セッションの有効期限が切れました。再ログインしてください。</p>
        <form action={async () => { "use server"; await signIn("google"); }}>
          <button className="rounded-full bg-black px-6 py-3 text-white cursor-pointer">
            再ログイン
          </button>
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

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">今週の空きサマリー</h1>
        <form action={async () => { "use server"; await signOut(); }}>
          <button className="rounded-full border px-4 py-2 text-sm cursor-pointer">
            ログアウト
          </button>
        </form>
      </div>

      {/* 一文で依頼を入力 */}
      <form className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="例: 来週 長尾さんと60分"
          className="flex-1 rounded border px-3 py-2 text-sm"
        />
        <button className="rounded bg-black px-4 py-2 text-sm text-white cursor-pointer">
          解析
        </button>
      </form>

      {parsed && (
        <div className="mb-6 rounded-lg border p-4 text-sm">
          <p className="mb-2 font-medium">解析結果（MeetingRequest）</p>
          <pre className="overflow-x-auto rounded bg-zinc-50 p-2 text-xs">
            {JSON.stringify(parsed.request, null, 2)}
          </pre>
          <p className="mt-2">
            参加者の解決:{" "}
            {parsed.matched.map((m) => m.name).join("・") || "なし"}
            {parsed.unmatched.length > 0 && (
              <span className="text-red-600">
                （未解決: {parsed.unmatched.join("・")}）
              </span>
            )}
          </p>
        </div>
      )}

      <p className="mb-3 text-sm text-zinc-500">
        対象: {PEOPLE.map((p) => p.name).join("・")}（{summary.totalPeople}人）＋ {ROOM.name}
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
                <td className="pr-2 text-right text-zinc-500 whitespace-nowrap">
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
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-zinc-600">
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
        <span>※ セル内の数字＝空いている人数</span>
      </div>
    </main>
  );
}
