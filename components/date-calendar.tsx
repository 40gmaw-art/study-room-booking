"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getMonthGridWeeks, getTodayDateKey, isBookingDateAllowed } from "@/lib/booking";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function parseYearMonth(dateKey: string) {
  const [year, month] = dateKey.split("-").map(Number);
  return { year, month };
}

export function DateCalendar({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: string;
  onSelectDate: (dateKey: string) => void;
}) {
  const todayKey = getTodayDateKey();
  const [view, setView] = useState(() => parseYearMonth(selectedDate || todayKey));

  const weeks = useMemo(() => getMonthGridWeeks(view.year, view.month), [view.year, view.month]);

  function goToMonth(delta: number) {
    setView((prev) => {
      const zeroBasedMonth = prev.month - 1 + delta;
      const year = prev.year + Math.floor(zeroBasedMonth / 12);
      const month = ((zeroBasedMonth % 12) + 12) % 12 + 1;
      return { year, month };
    });
  }

  function goToToday() {
    setView(parseYearMonth(todayKey));
    if (isBookingDateAllowed(todayKey)) {
      onSelectDate(todayKey);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goToToday}
          className="rounded-full border border-[#4B3B71]/20 px-3 py-1.5 text-xs font-semibold text-[#4B3B71] hover:bg-[#f5efff] md:text-sm"
        >
          오늘
        </button>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => goToMonth(-1)}
            aria-label="이전 달"
            className="rounded-full p-1.5 text-[#4B3B71] hover:bg-[#f5efff]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[84px] text-center text-sm font-bold text-[#4B3B71] md:text-base">
            {view.year}.{String(view.month).padStart(2, "0")}
          </span>
          <button
            type="button"
            onClick={() => goToMonth(1)}
            aria-label="다음 달"
            className="rounded-full p-1.5 text-[#4B3B71] hover:bg-[#f5efff]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500 md:text-sm">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-1">
            {label}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {weeks.flatMap((week, weekIndex) =>
          week.map((cell, cellIndex) => {
            if (!cell) {
              return <div key={`blank-${weekIndex}-${cellIndex}`} aria-hidden className="aspect-square" />;
            }

            const enabled = isBookingDateAllowed(cell.dateKey);
            const isSelected = cell.dateKey === selectedDate;
            const isToday = cell.dateKey === todayKey;

            return (
              <button
                key={cell.dateKey}
                type="button"
                onClick={() => enabled && onSelectDate(cell.dateKey)}
                disabled={!enabled}
                aria-pressed={isSelected}
                className={`aspect-square rounded-xl text-base font-semibold transition-colors md:text-lg ${
                  isSelected
                    ? "bg-[#4B3B71] text-white"
                    : enabled
                      ? "bg-white text-slate-700 hover:bg-[#f5efff]"
                      : "cursor-not-allowed bg-slate-50 text-slate-300"
                } ${isToday && !isSelected ? "ring-1 ring-inset ring-[#4B3B71]/40" : ""}`}
              >
                {cell.day}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
