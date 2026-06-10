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

// 候補1件（start/end/score/roomAvailable=決定的, reason/warnings=AI生成）
export const CandidateSchema = z.object({
  start: z.string(),
  end: z.string(),
  score: z.number(),
  reason: z.string(),
  warnings: z.array(z.string()).default([]),
  roomAvailable: z.boolean(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

// AIに作らせるのは reason/warnings だけ（入力スロットと同順・同数で返させる）
export const SlotReasonsSchema = z.object({
  items: z
    .array(
      z.object({
        reason: z.string().describe("この時間が良い理由を1文・簡潔・日本語で"),
        warnings: z
          .array(z.string())
          .describe("懸念（会議室が空いていない等）。無ければ空配列"),
      }),
    )
    .describe("入力スロットと同じ順序・同じ件数で返すこと"),
});