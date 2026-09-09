"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cancelReservationAction } from "@/lib/booking-actions";
import { formatTimeRange, getStatusLabel, TIME_SLOTS } from "@/lib/booking";

export type MyReservationRow = {
  reservation_number: string;
  reservation_date: string;
  start_time: string;
  status: string;
  participant_count: number;
  created_at: string;
  cancelled_at: string | null;
};

type CancelState = { success: boolean; message: string; reservationNumber?: string };

const initialCancelState: CancelState = { success: false, message: "" };

function formatSlotTime(startTime: string) {
  const slot = TIME_SLOTS.find((item) => item.value === startTime);
  return slot ? formatTimeRange({ start: slot.start, end: slot.end }) : startTime;
}

export function MyReservationsList({ initialReservations }: { initialReservations: MyReservationRow[] }) {
  const [reservations, setReservations] = useState(initialReservations);
  const [cancelTarget, setCancelTarget] = useState<MyReservationRow | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [cancelState, cancelAction, isCancelling] = useActionState(cancelReservationAction, initialCancelState);

  useEffect(() => {
    if (!cancelState.message) {
      return;
    }

    if (cancelState.success && cancelState.reservationNumber) {
      const cancelledNumber = cancelState.reservationNumber;
      setReservations((prev) =>
        prev.map((row) =>
          row.reservation_number === cancelledNumber
            ? { ...row, status: "cancelled", cancelled_at: row.cancelled_at ?? new Date().toISOString() }
            : row,
        ),
      );
      setCancelTarget(null);
    }

    setFeedback({ tone: cancelState.success ? "success" : "error", text: cancelState.message });
  }, [cancelState]);

  return (
    <>
      {feedback ? (
        <div
          className={`rounded-2xl p-3 text-sm ${
            feedback.tone === "success" ? "bg-[#f5efff] text-[#4B3B71]" : "bg-red-50 text-red-600"
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {!reservations.length ? (
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">예약 내역이 없습니다.</div>
      ) : (
        reservations.map((reservation) => {
          const isActive = reservation.status !== "cancelled";
          return (
            <div key={reservation.reservation_number} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-[#4B3B71]">{formatSlotTime(reservation.start_time)}</p>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    isActive ? "bg-[#f5efff] text-[#4B3B71]" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {getStatusLabel(reservation.status)}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                <div>날짜: {reservation.reservation_date}</div>
                <div>예약 인원: {reservation.participant_count}명</div>
                <div>생성일: {reservation.created_at}</div>
                <div>취소일: {reservation.cancelled_at ?? "-"}</div>
              </div>
              {isActive ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => setCancelTarget(reservation)}
                  >
                    예약 취소
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })
      )}

      {cancelTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-[#241b35]">예약을 취소하시겠습니까?</h2>
            <div className="mt-4 space-y-1 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p>
                <span className="text-slate-500">날짜:</span> {cancelTarget.reservation_date}
              </p>
              <p>
                <span className="text-slate-500">시간:</span> {formatSlotTime(cancelTarget.start_time)}
              </p>
              <p>
                <span className="text-slate-500">예약 인원:</span> {cancelTarget.participant_count}명
              </p>
            </div>
            <p className="mt-3 text-xs font-semibold text-red-600">취소된 예약은 복구할 수 없습니다.</p>
            <form action={cancelAction} className="mt-5 flex justify-end gap-2">
              <input type="hidden" name="reservationNumber" value={cancelTarget.reservation_number} />
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setCancelTarget(null)}
                disabled={isCancelling}
              >
                닫기
              </Button>
              <Button
                type="submit"
                className="rounded-full bg-red-600 text-white hover:bg-red-700"
                disabled={isCancelling}
              >
                {isCancelling ? "취소 처리 중..." : "취소하기"}
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
