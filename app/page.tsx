import { auth, signIn, signOut } from "@/auth";
import { listEventsForTargets } from "@/lib/google";
import { buildTargets } from "@/lib/people";

export default async function Home() {
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
          <button className="rounded-fulite cursor-pointer">
            再ログイン
          </button>
        </form>
      </main>
    );
  }

  // 今から2週間分を取得対象期間とする
  const now = new Date();
  const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const results = await listEventsForTargets(
    session.accessToken,
    buildTargets(),
    now.toISOString(),
    twoWeeksLater.toISOString(),
  );

  return (
     <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">取得確認（2-A）</h1>
        <form action={async () => { "use server"; await signOut(); }}>
          <button className="rounded-fulursor-pointer cursor-pointer">
            ログアウト
          </button>
        </form>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">対象</th>
            <th className="py-2">取得件数（2週間）</th>
            <th className="py-2">状態</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
             <tr key={r.calendarId} className="border-b">
              <td className="py-2">{r.name}</td>
              <td className="py-2">{r.events.length} 件</td>
              <td className="py-2">
                {r.error ? (
                  <span className="text-red-600">エラー</span>
                ) : (
                  <span className="text-green-600">OK</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}