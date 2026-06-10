import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { MeetingRequestSchema, SlotReasonsSchema, type MeetingRequest } from "./schemas";

// モデルは1か所に集約（将来ここを差し替えれば全体が切り替わる）
const model = google("gemini-2.5-flash-lite");

// 依頼文 → MeetingRequest に構造化
export async function parseMeetingRequest(userText: string): Promise<MeetingRequest> {
  // 相対日付(来週/明日)を解決させるため、今日のJST日付を渡す
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());

  const { output } = await generateText({
    model,
    output: Output.object({
      schema: MeetingRequestSchema,
    }),
    prompt: `次の会議調整の依頼文を構造化してください。
            今日は ${today}（Asia/Tokyo）です。「来週」「明日」などの相対表現は絶対日付(YYYY-MM-DD)に解決してください。
            所要時間の指定が無ければ 60 分。期間の指定が無ければ翌営業日から約2週間後までにしてください。
            依頼文: """${userText}"""`,
  });

  return output;
}

// 候補スロット → reason/warnings を生成（並べ替え・採点はしない）
export async function addReasons(
  slots: { start: string; end: string; roomAvailable: boolean }[],
): Promise<{ reason: string; warnings: string[] }[]> {
  if (slots.length === 0) return [];

  const { output } = await generateText({
    model,
    output: Output.object({ schema: SlotReasonsSchema }),
    prompt: `次の会議候補スロットそれぞれに、参加しやすい短い理由(reason)を1文で付け、
            懸念があれば warnings に入れてください。roomAvailable が false のスロットは「会議室が空いていない」旨を必ず warnings に入れてください。
            入力と同じ順序・同じ件数で返すこと。
            スロット一覧: ${JSON.stringify(slots)}`,
  });

  return output.items;
}