import { z } from "zod";

export const MeetingRequestSchema = z.object({
  participants: z
    .array(z.string())
    .describe("会議の参加者の呼び名（依頼文に出てくる名前。敬称は含めてよい）"),
  durationMinutes: z
    .number()
    .describe("会議の所要時間（分）。依頼文に無ければ 60"),
  dateRange: z
    .object({
      from: z.string().describe("候補探索の開始日 YYYY-MM-DD"),
      to: z.string().describe("候補探索の終了日 YYYY-MM-DD"),
    })
    .describe("候補を探す期間。未指定なら翌営業日〜約2週間後"),
  headcount: z
    .number()
    .nullable()
    .describe("人数指定があればその数、無ければ null"),
});

export type MeetingRequest = z.infer<typeof MeetingRequestSchema>;