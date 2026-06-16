"use client";

import { useState } from "react";
import { BookButton } from "./book-button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export type CandidateRow = {
  start: string;
  end: string;
  label: string; // 表示用に整形済みの日時範囲
  roomAvailable: boolean;
  adjustable: boolean; // soft衝突あり（予定はあるが調整できるかも）
  softConflicts: string[]; // 予定がある人の名前
};

// 候補リスト（会議名は上部の共有欄。どの候補を予約してもこの名前を使う）
export function CandidateList({
  rows,
  peopleAttendees,
  roomCalendarId,
  defaultSummary,
}: {
  rows: CandidateRow[];
  peopleAttendees: string[]; // 参加者（会議室は含まない）
  roomCalendarId: string;
  defaultSummary: string;
}) {
  const [title, setTitle] = useState("");
  const summary = title.trim() || defaultSummary; // 空欄なら自動の「会議：名前」

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">会議名</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`例: ${defaultSummary || "会議"}`}
          className="max-w-md"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((c) => {
          // 会議室が空きなら参加者＋会議室、埋まっていれば参加者だけ（会議室なしで予約）
          const rowAttendees = c.roomAvailable
            ? [...peopleAttendees, roomCalendarId]
            : peopleAttendees;
          const rowSummary = c.roomAvailable ? summary : `${summary}（会議室なし）`;
          return (
            <Card key={c.start} className="gap-2">
              <CardContent className="flex h-full flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {c.adjustable ? (
                    <Badge className="border-transparent bg-orange-300 text-orange-950">
                      要調整
                    </Badge>
                  ) : (
                    <Badge variant="secondary">空き</Badge>
                  )}
                  <Badge variant={c.roomAvailable ? "secondary" : "destructive"}>
                    {c.roomAvailable ? "会議室 空き" : "会議室 埋"}
                  </Badge>
                </div>

                <span className="font-medium">{c.label}</span>

                {!c.roomAvailable && (
                  <p className="text-xs text-red-600">
                    会議室が空いていません（会議室なしで予約します）
                  </p>
                )}

                {c.adjustable && c.softConflicts.length > 0 && (
                  <p className="text-xs text-amber-600">
                    {c.softConflicts.join("・")} に予定あり（調整できるかも）
                  </p>
                )}

                <div className="mt-auto pt-1">
                  <BookButton
                    start={c.start}
                    end={c.end}
                    summary={rowSummary}
                    attendees={rowAttendees}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
