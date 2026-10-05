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
        className="w-full max-w-md rounded-md border border-slate-200 bg-white p-6 shadow-xl shadow-slate-950/15 sm:p-8"
        role="dialog"
      >
        <h2 id="student-usage-notice-title" className="text-xl font-bold tracking-tight text-[#4B3B71] sm:text-2xl">
          스터디룸 이용 안내
        </h2>

        <div className="mt-5 border-t border-slate-100 pt-5">
          <p className="text-sm font-medium text-slate-600">노쇼 또는 이용 후 미정리 시</p>
          <div className="mt-3 space-y-2 border-l-2 border-[#4B3B71]/50 bg-[#f8f4ff] px-4 py-3">
            <p className="text-base font-bold text-[#4B3B71] sm:text-lg">1회 · 1개월 예약 제한</p>
            <p className="text-base font-bold text-[#4B3B71] sm:text-lg">2회 · 예약 이용 불가</p>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            쾌적한 이용을 위해 이용수칙을 지켜주세요.
          </p>
        </div>

        {storageError ? (
          <p className="mt-3 text-xs text-red-600" role="alert">
            오늘 하루 안 보기 설정을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.
          </p>
        ) : null}

        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
          <Button
            className="h-8 rounded-md px-3 text-xs text-slate-600"
            onClick={() => setIsOpen(false)}
            type="button"
            variant="ghost"
          >
            닫기 X
          </Button>
          <Button
            className="h-8 rounded-md border-[#4B3B71]/30 px-3 text-xs text-[#4B3B71] hover:bg-[#f8f4ff]"
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
