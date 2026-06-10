import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { MeetingRequestSchema, type MeetingRequest } from "./schemas";

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