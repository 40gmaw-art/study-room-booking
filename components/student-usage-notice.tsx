"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "study-room-usage-notice-dismissed";

function getLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function StudentUsageNotice() {
  const [isOpen, setIsOpen] = useState(false);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    try {
      const savedValue = window.localStorage.getItem(STORAGE_KEY);
      const savedDate = savedValue ? JSON.parse(savedValue)?.date : null;

      setIsOpen(savedDate !== getLocalDate());
    } catch {
      setIsOpen(true);
    }
  }, []);

  function dismissForToday() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: getLocalDate() }));
      setIsOpen(false);
    } catch {
      setStorageError(true);
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 px-4 py-6">
      <section
        aria-labelledby="student-usage-notice-title"
        aria-modal="true"
        className="w-full max-w-md rounded-sm border-2 border-[#4B3B71]/35 bg-white shadow-sm"
        role="dialog"
      >
        <h2
          id="student-usage-notice-title"
          className="border-b border-slate-300 px-5 py-4 text-xl font-bold text-[#4B3B71] sm:text-2xl"
        >
          스터디룸 이용 안내
        </h2>

        <div className="border-b border-slate-300 px-5 py-5">
          <p className="text-base font-medium text-slate-700">노쇼 또는 이용 후 미정리 시</p>
          <div className="mt-3 space-y-2 border border-[#4B3B71]/25 bg-[#f8f4ff] px-4 py-3">
            <p className="text-base font-bold text-[#4B3B71] sm:text-lg">1회 · 1개월 예약 제한</p>
            <p className="text-base font-bold text-[#4B3B71] sm:text-lg">2회 · 예약 이용 불가</p>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            쾌적한 이용을 위해 이용수칙을 지켜주세요.
          </p>
        </div>

        {storageError ? (
          <p className="px-5 pt-3 text-xs text-red-600" role="alert">
            오늘 하루 안 보기 설정을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.
          </p>
        ) : null}

        <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
          <Button
            className="h-8 rounded-sm border-slate-300 px-3 text-xs text-slate-700 hover:bg-white"
            onClick={() => setIsOpen(false)}
            type="button"
            variant="outline"
          >
            닫기 X
          </Button>
          <Button
            className="h-8 rounded-sm border-2 border-[#4B3B71]/55 bg-white px-3 text-xs text-[#4B3B71] hover:bg-[#f8f4ff]"
            onClick={dismissForToday}
            type="button"
            variant="outline"
          >
            오늘 하루 안보기 X
          </Button>
        </div>
      </section>
    </div>
  );
}
