# 会議日程調整AI — 設計ドキュメント / Claude Code 実装ブリーフ

> **版**: v2（2026-06-08 合意反映版）。初版の構成を踏襲しつつ、ヒアリングで確定した前提を反映した。
> 変更の要点は「§0.1 確定した前提」と各章の **★決定** マークを参照。

---

## 0. このドキュメントの使い方（Claude Code 向け）

- このファイルをリポジトリのルートに置き、Claude Code に「これを読んで §9 のマイルストーン順に実装して」と指示する。
- **一度に全部作らない。** §9 のマイルストーン単位で「動く → 確認 → 次」を繰り返す。各マイルストーンには受け入れ条件（Acceptance）を明記してある。
- 不確実な外部仕様（Vercel AI SDK / Auth.js / Google Calendar API / Gemini のバージョン差）は、推測で進めず**最新の公式ドキュメントを確認**してから実装する。
- 本ドキュメントの技術前提は 2026年1月時点の知識ベース。API名やモデル名は実装時に最新版で照合すること。
- このプロジェクトは Next.js が**学習データと異なる版**の可能性がある（`AGENTS.md` 参照）。実装前に `node_modules/next/dist/docs/` の該当ガイドを読むこと。

---

## 0.1 確定した前提（ヒアリング結果 / ★この版の核）

| # | 項目 | 確定内容 |
|---|---|---|
| 認証 | カレンダー共有 | **全員が予定詳細を共有済み** → `events.list` で全員の予定（タイトル・説明）を読める。権限交渉は不要 |
| 会議室 | 対象 | **「01_会議室」（姫路本社2F・定員10）の1部屋のみ**。他リソース（02_中部屋/03_給湯室）は対象外 |
| 会議室 | 運用実態 | **リソースカレンダーとして予約運用されている（実態A）**前提。→ **リソースカレンダー主軸**で正確に占有を取得 |
| 会議室 | 接頭辞「会議」 | リソース運用主軸のため、接頭辞は**「リソース未予約だが会議室を使っていそうな予定＝付け忘れ」を検出する補助**に降格（ダブルブッキング警告の材料） |
| 空き | 営業時間 | **平日 9:00–18:00**。**昼休み（12–13時）は除外しない**（昼にも会議があり、各人がそれに合わせて昼休みを取るため）。土日・深夜は候補に出さない |
| 空き | 探索期間デフォルト | 依頼文に期間指定がない場合は **翌営業日〜2週間（約10営業日）** を上限に探索し、**近い順**で上位を提示 |
| AI分類 | 実質の空き | 仮予定/タスク枠などは **「調整可能かも」と表示・注釈するだけ**。基本は空きとして積極的に推さない（角を立てない） |
| UI | 棲み分け | トップに **軽量な週サマリー**（会議室占有＋各人の空き濃淡）。個々の予定詳細は出さず、**Googleカレンダーへリンク**して補完する（再実装による二度手間を避ける） |
| UI | プライバシー | 他人の**予定タイトルは表示しない**。空き/埋＋会議室占有のみ見せる |
| 規模 | 対象 | **10〜15人＋1部屋** |
| AI | プロバイダ | まず **Gemini 2.5 Flash-Lite**（Google AI Studio 無料枠でテスト）。本番でユーザーが増えたら上位モデルへ差し替え。モデルは差し替え可能に設計 |
| AI | 観測 | **Langfuse**（第一候補）または **Vercel AI Gateway** で AI 活用ログ・トレースを取得（学習目的も兼ねる）。AI SDK のテレメトリ機能経由で接続 |
| 解決 | 名前→メール | **簡易マッピング**（10〜15人の「名前→メール」表を設定ファイル/定数で保持）。MVPはこれで十分 |

### 役割分担（AI vs 決定的コード）★重要な思想
| 仕事 | 担当 | 理由 |
|---|---|---|
| 会議室の空き | **決定的コード** | リソース運用ありなら正確に取れる。AI不要 |
| 共通空きスロットの算出・営業時間絞り込み | **決定的コード** | 速くて安く、挙動が読める |
| 自然言語パース（依頼文→構造化） | **AI** | AIの独壇場 |
| 各人の「実質の空き」分類（仮予定/タスク枠） | **AI**（曖昧な予定のみ） | Googleの機械シグナルで取れない分を補う |
| 候補の根拠文（reason）生成 | **AI** | 説明性。トークン節約のため文生成に絞る |
| リソース付け忘れ検出（ダブルブッキング警告） | **AI＋コード** | 中途半端な運用を救う差別化点 |

---

## 1. プロジェクト概要

| 項目 | 内容 |
|---|---|
| 名称（仮） | MeetFinder（会議日程調整AI） |
| 目的 | 会議室予約・日程調整における「見えているようで見えていない」手間を、AIで減らす |
| 利用者 | 社内スタッフ（Google Workspace ユーザー、10〜15人） |
| 開発体制 | 一人開発 |
| 期間 | 〜2026/06/30 |
| 評価軸 | 機能 + **どれだけ速く作れたか** + **AIをどう活用したか** |

### ゴール
「**誰と・どれくらい・いつ頃**」を一文で入力すると、AIが全員と会議室（01_会議室）の空きを踏まえて**根拠つきの候補スロットを提示**し、**ワンタップで予定作成＋会議室確保**まで行える。あわせて、トップ画面で**今週の会議室占有と各人の空き**を一目で把握できる。

---

## 2. 課題定義（なぜAIが必要か）

カレンダー上で「空き」は見えるが、実務では次の不便さがある。

1. 参加者・会議室・人数を個別に確認する手間。
2. **「カレンダーが空いている ≠ 本当に空いている」**：人によってタスク・集中時間・仮予定も登録しており、使い方がバラバラ。
3. 終日ブロック等でバーが長すぎ、会議室の占有が見えにくく**ダブルブッキング**が起きる。
4. 運用ルール（会議室リソースの予約、タイトルに「会議」を付ける等）は一部の人しか守っておらず、**運用が中途半端**。

### AIの価値（差別化ポイント）
単なる空き検索ではなく、**雑多な人間のカレンダーを「解釈」する**ことがAIの仕事。

- 予定のタイトル・説明から「確定会議／柔らかいタスク枠／仮予定／終日ブロック」を**分類**し、「実質の空き」を**注釈**する（推さず、見せる）。
- 自然言語の依頼文を構造化リクエストに**パース**する。
- 「会議室リソースを予約し忘れているが実は会議室を使っていそうな予定」を検出し、**ダブルブッキング予備軍として警告**する。

---

## 3. スコープ

### MVP（必須）
- Google ログイン（offline access、refresh token 自動更新）。
- 自然言語 or 軽いフォームで依頼入力。
- 全員（簡易マッピングの対象者）＋ **01_会議室** の空きを取得して候補スロットを算出。
- AIが候補を**根拠つきでランキング**して提示。
- ワンタップで**予定作成 +（必要なら）会議室予約**（確定直前に再チェック）。
- **トップに軽量週サマリー**（会議室占有＋各人の空き濃淡。詳細は出さずGoogleへリンク）。

### 本命（旧ストレッチから格上げ）
- `events.list` で予定詳細を読み、**AI分類で「実質の空き」を注釈**（全員が詳細共有済みのため最初から実装可）。
- **リソース付け忘れ検出**による**ダブルブッキング警告**。

### 対象外
- 社外向け予約ページ・外部公開URL。
- 繰り返し予定の将来衝突アラート。
- 01_会議室以外のリソース（02/03）の対応。
- 締め切り以後の継続実装（誰かが引き継ぐ想定）。

---

## 4. 技術スタック

| レイヤー | 採用 | 備考 |
|---|---|---|
| 言語 | TypeScript | |
| フレームワーク | **Next.js（App Router）** | フロント+APIを1リポジトリで。Server Actions / Route Handlers。**学習データと異なる版の可能性 → 実装前に `node_modules/next/dist/docs/` 確認** |
| 認証 | **Auth.js（NextAuth）** Google Provider | access/refresh トークン取得、**refresh token 自動更新**、OAuthスコープ管理 |
| AI | **Vercel AI SDK** | `generateText`/`streamText` + `Output.object`（構造化）/ tool calling / `useChat` |
| AIプロバイダ | **Gemini 2.5 Flash-Lite**（`@ai-sdk/google`）→ 本番で上位モデル | モデル名は実装時に最新確認。プロバイダ/モデルは差し替え可能に抽象化 |
| AI観測 | **Langfuse**（第一候補）/ Vercel AI Gateway | AI SDK のテレメトリ（OpenTelemetry）経由でトレース送信。学習目的も兼ねる |
| UI | React + Tailwind CSS | 週サマリー（グリッド）＋ チャット入力 ＋ 候補カード |
| データ | **MVPはDBなし** | カレンダーが真実の源泉。名前→メールは簡易マッピング（設定ファイル/定数） |
| 外部API | **Google Calendar API** | events.list（主軸）/ FreeBusy（確定直前の再チェック）/ リソースカレンダー（01_会議室） |
| デプロイ | Vercel | OAuth リダイレクトURL・環境変数を設定 |

---

## 5. アーキテクチャ / リクエストの流れ

```
[ユーザー] 「来週、内田さんと玉木さんと1時間」
   │  (1) 自然言語入力
   ▼
[Next.js フロント] useChat / フォーム ／ トップは週サマリー
   │
   ▼
[Route Handler / Server Action]
   │  (2) generateText + Output.object で構造化 → MeetingRequest
   │      （名前→メールは簡易マッピングで解決）
   │  (3) 空き取得（決定的コード）
   │        ├─ listEvents(people[], 01_会議室, range) → Google events.list
   │        ├─ 営業時間(平日9-18)・期間(2週)で絞り、共通空きスロットを算出
   │        └─ 会議室占有はリソースカレンダーの予約から判定（＋接頭辞で付け忘れ検出）
   │  (4) AI分類: 曖昧な予定を hard/soft/tentative/allday_block に分類 →「実質の空き」を注釈
   │  (5) generateText + Output.object で候補に根拠(reason)付与 → Candidate[]
   ▼
[フロント] 候補カード（根拠つき・警告つき）を提示
   │  (6) ワンタップ確定
   ▼
[Route Handler] 確定直前に FreeBusy 再確認 → Google Events.insert
                （attendees に人 + 01_会議室リソース、タイトルに「会議」付与）
```

### コンポーネント
- `app/page.tsx` … トップ：週サマリー + 入力UI + 候補表示
- `app/api/chat/route.ts` … AIオーケストレーション（パース→空き取得→分類→根拠付け）
- `app/api/book/route.ts` … 予定作成 + 会議室予約（確定直前の再チェック含む）
- `lib/google.ts` … Google Calendar クライアント（events.list / freeBusy / events.insert / リソース）
- `lib/availability.ts` … 決定的な空き計算（営業時間・期間絞り込み・共通スロット・会議室占有）
- `lib/ai.ts` … AI SDK ラッパー（intent parse / classify / reason 生成）＋ テレメトリ設定
- `lib/schemas.ts` … Zod スキーマ & 型
- `lib/people.ts` … 名前→メール 簡易マッピング、会議室リソースID

---

## 6. Google Calendar API の使い方

### OAuth / 権限
- GCP で **OAuth 同意画面を「内部（Internal）」** に設定（審査・警告画面を回避）。
- 必要スコープ：

| スコープ | 用途 | 必須度 |
|---|---|---|
| `.../auth/calendar.readonly` | 予定の**詳細**読み取り（events.list・AI分類・会議室占有） | **MVP必須**（全員詳細共有済みのため最初から使う） |
| `.../auth/calendar.events` | 予定の作成（events.insert） | MVP必須 |
| `.../auth/calendar.freebusy` | 確定直前の空き再確認 | MVP必須（補助） |

### events.list（主軸：全員＋会議室の中身を取る）
```
GET /calendar/v3/calendars/{calendarId}/events?timeMin=...&timeMax=...&singleEvents=true&orderBy=startTime
// 各メンバーの primary と 01_会議室リソースに対して取得
// → summary（タイトル）, description, status, transparency, eventType, attendees などが取れる
```
- 機械シグナル（`transparency`=opaque/transparent、`status`、`eventType`、終日か、`attendees.responseStatus`）を**まず決定的に利用**。
- 取りきれない曖昧な予定だけ AI 分類に回す（§7）。
- **会議室占有**＝ 01_会議室リソースの events に予定が入っている時間帯。**付け忘れ検出**＝ 人の予定で「会議」接頭辞があるのにリソース未予約のもの。

> ⚠ **要確認（実態A前提の検証）**: 実装着手前に 01_会議室リソースカレンダーに実際に予約が入っているかを一度確認し、リソースIDを取得すること。空に近ければ接頭辞集計の比重を上げる。

### FreeBusy（確定直前の再チェックに使用）
```
POST https://www.googleapis.com/calendar/v3/freeBusy
{ "timeMin": "...", "timeMax": "...",
  "items": [ {"id":"member..."}, {"id":"01_会議室リソースID"} ] }
```

### events.insert（確定時）
```
POST /calendar/v3/calendars/primary/events
{ "summary": "会議：...", "start": {...}, "end": {...},
  "attendees": [ {email: 人...}, {email: 01_会議室リソースID} ] }
// タイトルに「会議」プレフィックスを付与（社内ルール準拠）／リソースをattendeeに追加
```
> **重要（ダブルブッキング防止）**：候補提示から確定までの間に他者が予約する可能性があるため、
> `events.insert` の**直前に対象スロットの FreeBusy を再確認**し、埋まっていたら確定を中止して再提示する。

---

## 7. AI レイヤーの設計（Vercel AI SDK）

> **構造化出力の方針**：**`generateText` / `streamText` + `experimental_output: Output.object({ schema })`** を使う。
> tool calling と構造化出力を同じ呼び出しで両立でき、ストリーミングで部分的な構造化結果も受け取れる。
> `experimental_` 接頭辞や戻り値の取り出し方はバージョンで変わりうるため、**実装時に最新の公式ドキュメントで確認**すること。
> モデルは `@ai-sdk/google` の Gemini 2.5 Flash-Lite を既定とし、プロバイダを抽象化して差し替え可能にする。
> **テレメトリ**：AI SDK の `experimental_telemetry` 等を有効化し、Langfuse（または AI Gateway）へトレースを送る。

### (1) 依頼文の構造化 — `generateText` + `Output.object`
```ts
// lib/ai.ts （擬似コード。最新の AI SDK API で実装）
const { experimental_output: request } = await generateText({
  model,                    // 例: google('gemini-2.5-flash-lite')
  experimental_output: Output.object({ schema: MeetingRequestSchema }),
  prompt: `次の依頼文を構造化して: """${userText}"""
           今日は ${today}。相対表現（来週など）は絶対日付に解決すること。`,
  experimental_telemetry: { isEnabled: true /* + Langfuse 設定 */ },
});
// 名前→メールは簡易マッピングで後段解決（lib/people.ts）
```

### (2) 予定の分類（本命）— 曖昧な予定のみ AI に渡す
機械シグナルで判定できない予定だけを下記カテゴリに分類し、「実質の空き」の**注釈**に使う（候補から外したり積極的に空きと推したりはしない）。
- `hard` … 確定会議・商談（動かせない）
- `soft` … タスク枠・作業時間（相談で動かせる）→「調整可能かも」と注釈
- `tentative` … 仮予定
- `allday_block` … 終日ブロック（会議室占有の有無を別途判定）

### (3) 候補の根拠付け — `generateText` + `Output.object`
**スコアリング・並べ替えは決定的コードで行い**、AIは各候補の `reason`（短い根拠文）と `warnings` 生成に絞る（トークン節約）。
```ts
const { experimental_output } = await generateText({
  model,
  experimental_output: Output.object({
    schema: z.object({ candidates: z.array(CandidateSchema) }),
  }),
  prompt: `次の空きスロット候補それぞれに、全員が参加しやすい理由を短い根拠(reason)として付け、
           懸念があれば warnings に書いて: ${JSON.stringify(slots)}`,
});
```

### tool calling（任意）
`getFreeBusy` / `listEvents` をツール化してAIに呼ばせる構成も可能だが、**MVPは「パース→決定的に空き計算→AIは分類と根拠文」の固定フロー**を採る（挙動が読めて速く安い）。フルなツール駆動は後回し。

---

## 8. データモデル / 型（Zod）

```ts
// lib/schemas.ts
import { z } from "zod";

export const MeetingRequestSchema = z.object({
  participants: z.array(z.string()),        // 名前 or メール（簡易マッピングで解決）
  durationMinutes: z.number(),              // 例: 60
  dateRange: z.object({ from: z.string(), to: z.string() }), // ISO日付。未指定は翌営業日〜2週
  headcount: z.number().nullable(),
});
export type MeetingRequest = z.infer<typeof MeetingRequestSchema>;

export const CandidateSchema = z.object({
  start: z.string(),                        // ISO（+09:00）
  end: z.string(),
  score: z.number(),                        // 0-100（決定的に算出）
  reason: z.string(),                       // 「全員空き / 午前は集中時間を避けた」等（AI生成）
  warnings: z.array(z.string()).default([]),// 「終日ブロックあり要確認」「会議室付け忘れ疑い」等
  roomAvailable: z.boolean(),               // 01_会議室が空いているか
});
export type Candidate = z.infer<typeof CandidateSchema>;
```
> 会議室は1部屋固定のため `room` フィールドは持たず、`roomAvailable` で占有を表す。

---

## 9. 実装ステップ / マイルストーン（★再編）

> **順番厳守。各ステップで動かして確認してから次へ。**

### M0. プロジェクト雛形
- Next.js（App Router, TS）+ Tailwind + AI SDK（+ `@ai-sdk/google`）+ Auth.js を導入。
- **Acceptance:** `npm run dev` でトップページが表示される。

### M1. Google ログイン + 自分の予定（events.list）
- Auth.js Google Provider 設定（**offline access、refresh token 自動更新**、readonly/events/freebusy スコープ）。
- 自分の `primary` の今週の予定を `events.list` で取得して表示。
- **Acceptance:** ログイン後、自分の今週の予定（busy 区間）が一覧表示される。トークン失効後も自動更新で継続動作する。

### M2. 週サマリー：全員＋会議室の空き（決定的ロジック）★中核
- 簡易マッピングの対象者 + 01_会議室リソースの予定を `events.list` で取得。
- **平日9:00–18:00**（昼休みは除外しない）・**2週間**で絞り、共通空きスロットを算出。
- **トップに週サマリー**（縦=時間/横=曜日、会議室レーン＋各人の空き濃淡）を表示。詳細は出さずGoogleへリンク。
- **Acceptance:** 今週の会議室占有と各人の空きが1画面で見え、土日深夜は出ない。「2人+会議室で60分空くスロット」が営業時間内のみ正しく出る。

### M3. 自然言語 → 構造化（AI導入）
- `generateText` + `Output.object`（`MeetingRequestSchema`）で依頼文をパース（Gemini Flash-Lite）。
- 相対日付の解決、名前→メールは簡易マッピング。期間未指定は2週デフォルト。
- **Acceptance:** 「来週、内田さんと60分」→ 正しい `MeetingRequest` になり、M2に流し込める。

### M4. 候補提示（決定的スコア + AI根拠）
- 決定的に算出・スコア順に並べた空きスロットへ、AIで `reason`/`warnings` を付与し候補カード表示。
- **Acceptance:** 候補が近い順/スコア順に並び、各カードに根拠が出る。会議室が埋まっている枠はその旨が分かる。

### M5. ワンタップ予定作成 + 会議室予約
- 候補カードのボタンで、**確定直前に FreeBusy 再確認** → `events.insert`（attendees に人 + 01_会議室、タイトルに「会議」付与）。
- **Acceptance:** タップ後、実際にGoogleカレンダーに予定 + 会議室予約が入る。直前に埋まっていたら中止して再提示する。

### M6. AI分類で「実質の空き」注釈 + ダブルブッキング警告 ★本命
- `events.list` の詳細を AI で `hard/soft/tentative/allday_block` 分類（曖昧な予定のみ）。
- `soft/tentative` の時間帯を「**調整可能かも**」と**注釈表示**（候補には積極採用しない）。
- 「会議」接頭辞ありなのに 01_会議室リソース未予約の予定を**付け忘れ＝ダブルブッキング予備軍**として警告。
- **Acceptance:** タスク枠だけの時間帯が「調整可能」注釈付きで見え、付け忘れ疑いが警告される。

### M7. AI観測（Langfuse / AI Gateway）
- AI SDK のテレメトリを有効化し、Langfuse（または Vercel AI Gateway）へトレース送信。プロンプト/トークン/レイテンシを可視化。
- **Acceptance:** 各AI呼び出しがダッシュボードで追跡できる。

---

## 10. UX 方針（Simple is best）

- 入力は**一文**、出力は**候補カード**、確定は**ワンタップ**に寄せる。
- トップは**週サマリー**で全体像を一目で。詳細はGoogleカレンダーに任せる（補完であって代替ではない）。
- チャット入力をベースに、結果は会話内の**タップ可能なカード**で返す。
- 他人の予定タイトルは出さない（空き/埋＋会議室占有のみ）。余計な設定画面・必須項目を増やさない。

---

## 11. 環境変数（.env.local）

```
AUTH_SECRET=...
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
# AIプロバイダ（まず Gemini）
GOOGLE_GENERATIVE_AI_API_KEY=...
# AI観測（使う方）
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_BASEURL=...
# 会議室リソースカレンダーID（01_会議室）
ROOM_RESOURCE_ID=c_xxxx@resource.calendar.google.com
```
> 秘密情報ファイル（.env*）の中身はユーザーが管理する。Claude Code は中身を確認しない。

---

## 12. 提出物チェックリスト（ハッカソン）

- [ ] 企画・要件定義・設計資料 … **本ドキュメント**を流用
- [ ] 発表用資料（スクショで機能説明）
- [ ] **AI活用・バイブコーディング手法の共有資料**
- [ ] 使用工数（何時間で作れたか）

### AI活用ログ（作りながら都度メモ — 後回し厳禁）
- 使用したAI・モデル（Gemini Flash-Lite ほか）
- AIに任せた作業 / 人間が判断・修正した内容
- 実際に使ったプロンプト
- 使用した Skills・サブエージェント・支援ツール
- Langfuse/AI Gateway で観測した結果・気づき
- バイブコーディングの進め方
- うまくいった点 / いかなかった点
- 今後の業務に使えそうな学び

---

## 13. リスク / 留意点

- **アクセストークンの失効**：Google のアクセストークンは約1時間で切れる。**Auth.js で refresh token 自動更新**を M1 で必ず実装（offline access とセット）。
- **会議室の実態A検証**：実装着手前に 01_会議室リソースに実際の予約が入っているか・リソースIDを確認。空に近ければ接頭辞集計の比重を上げる。
- **接頭辞運用の穴**：オンライン会議でも「会議」と付く場合があり占有を誤検出しうる。逆に付け忘れは検出漏れ。リソース予約を主軸にしつつ、付け忘れは警告で救う。
- **タイムゾーン**：全処理を `Asia/Tokyo` + ISO（オフセット付き `+09:00`）で統一。UTCとの取り違えに注意。
- **営業時間の制約**：候補生成は必ず平日9–18で絞る（昼休みは除外しない）。深夜・土日は出さない。
- **ダブルブッキング防止**：確定（`events.insert`）の直前に FreeBusy を再確認。
- **プライバシー**：他人の予定タイトルを画面・ログに出さない。空き/埋のみ扱う。
- **AIコスト**：スコアリングは決定的ロジック、AIは分類（曖昧な予定のみ）と reason 生成に絞る。Flash-Lite + 無料枠でテストし、本番は使用量を見て上位モデルへ。
- **Next.js のバージョン差**：`node_modules/next/dist/docs/` を実装前に確認。
- 外部仕様（AI SDK / Auth.js / Google API / Gemini）のバージョン差は**実装時に公式ドキュメントで確認**。
