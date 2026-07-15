"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminCreateReservationAction,
  adminDeleteReservationAction,
  adminUpdateReservationAction,
  type AdminCreateReservationState,
} from "@/lib/booking-actions";
import { formatDateForDisplay, getStatusLabel, TIME_SLOTS } from "@/lib/booking";
import {
  type AdminReservationRow,
  formatFullKoreanDate,
  formatFullKoreanDateWithWeekday,
  groupActiveReservations,
  slotLabelFor,
} from "@/lib/admin-reservations";

const initialDeleteState = { success: false as boolean, message: "", reservationId: "" };
const initialCreateState: AdminCreateReservationState = { success: false, message: "", reservation: null };

export function AdminReservationManager({
  initialReservations,
  allowedDates,
}: {
  initialReservations: AdminReservationRow[];
  allowedDates: Array<{ date: string }>;
}) {
  const [reservations, setReservations] = useState(initialReservations);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminReservationRow | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [deleteState, deleteAction, isDeleting] = useActionState(adminDeleteReservationAction, initialDeleteState);

  const [createDate, setCreateDate] = useState(allowedDates[0]?.date ?? "");
  const [createStartTime, setCreateStartTime] = useState<string>(TIME_SLOTS[0].value);
  const [createName, setCreateName] = useState("");
  const [createDepartment, setCreateDepartment] = useState("");
  const [createStudentNumber, setCreateStudentNumber] = useState("");
  const [createParticipantCount, setCreateParticipantCount] = useState("1");
  const [createState, createAction, isCreating] = useActionState(adminCreateReservationAction, initialCreateState);

  const grouped = useMemo(() => groupActiveReservations(reservations), [reservations]);

  useEffect(() => {
    if (!createState.message) {
      return;
    }

    if (createState.success && createState.reservation) {
      setReservations((prev) => [...prev, createState.reservation as AdminReservationRow]);
      setCreateName("");
      setCreateDepartment("");
      setCreateStudentNumber("");
      setCreateParticipantCount("1");
      // Date/time selection is kept as-is so the admin can add another
      // reservation to the same slot without re-selecting it.
    }

    setFeedback({ tone: createState.success ? "success" : "error", text: createState.message });
  }, [createState]);

  useEffect(() => {
    if (!deleteState.reservationId) {
      return;
    }

    if (deleteState.success) {
      const removed = reservations.find((row) => row.id === deleteState.reservationId);
      setReservations((prev) => prev.filter((row) => row.id !== deleteState.reservationId));
      setEditingId((prev) => (prev === deleteState.reservationId ? null : prev));
      setDeleteTarget(null);
      if (removed) {
        setFeedback({
          tone: "success",
          text: `${removed.name}님의 ${formatFullKoreanDate(removed.reservation_date)} ${slotLabelFor(removed.start_time)} 예약을 삭제했습니다.`,
        });
      }
      return;
    }

    const alreadyGone = /존재하지 않는|이미 삭제/.test(deleteState.message);
    if (alreadyGone) {
      setReservations((prev) => prev.filter((row) => row.id !== deleteState.reservationId));
      setEditingId((prev) => (prev === deleteState.reservationId ? null : prev));
    }
    setDeleteTarget(null);
    setFeedback({ tone: "error", text: deleteState.message || "예약 삭제에 실패했습니다." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteState]);

  return (
    <div className="flex flex-col gap-4">
      {feedback ? (
        <div
          className={`rounded-2xl p-3 text-sm ${
            feedback.tone === "success" ? "bg-[#f5efff] text-[#4B3B71]" : "bg-red-50 text-red-600"
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
        <CardHeader>
          <CardTitle>새 예약 추가</CardTitle>
          <CardDescription>평일에만 이용할 수 있으며, 다음 주 금요일까지 예약 가능합니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createAction} className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="reservationDate">예약일</Label>
              <select
                id="reservationDate"
                name="reservationDate"
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={createDate}
                onChange={(event) => setCreateDate(event.target.value)}
              >
                {allowedDates.map((option) => (
                  <option key={option.date} value={option.date}>
                    {option.date} ({formatDateForDisplay(option.date)})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="startTime">시간대</Label>
              <select
                id="startTime"
                name="startTime"
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={createStartTime}
                onChange={(event) => setCreateStartTime(event.target.value)}
              >
                {TIME_SLOTS.map((slot) => (
                  <option key={slot.value} value={slot.value}>
                    {slot.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="name">이름</Label>
              <Input
                id="name"
                name="name"
                placeholder="이름"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="department">학과</Label>
              <Input
                id="department"
                name="department"
                placeholder="학과"
                value={createDepartment}
                onChange={(event) => setCreateDepartment(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="studentNumber">학번</Label>
              <Input
                id="studentNumber"
                name="studentNumber"
                placeholder="학번"
                value={createStudentNumber}
                onChange={(event) => setCreateStudentNumber(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="participantCount">예약 인원</Label>
              <Input
                id="participantCount"
                name="participantCount"
                type="number"
                inputMode="numeric"
                min={1}
                max={6}
                step={1}
                value={createParticipantCount}
                onChange={(event) => setCreateParticipantCount(event.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                type="submit"
                className="h-10 rounded-full bg-[#4B3B71] hover:bg-[#3f315d]"
                disabled={isCreating}
              >
                {isCreating ? "추가 중..." : "예약 추가"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {grouped.length === 0 ? (
        <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
          <CardContent className="p-6 text-center text-slate-500">등록된 예약이 없습니다.</CardContent>
        </Card>
      ) : (
        grouped.map((dateGroup) => (
          <Card key={dateGroup.date} className="border-[#4B3B71]/10 bg-white shadow-sm">
            <CardHeader>
              <CardTitle>{formatFullKoreanDateWithWeekday(dateGroup.date)}</CardTitle>
              <CardDescription>
                총 예약 {dateGroup.totalReservationCount}건 · 예약된 시간대 {dateGroup.slots.length}개 · 총 예약 인원{" "}
                {dateGroup.totalParticipantCount}명
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {dateGroup.slots.map((slot) => (
                <div key={slot.startTime}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold text-[#241b35]">{slot.label}</span>
                    <span className={`text-sm font-semibold ${slot.full ? "text-red-600" : "text-[#4B3B71]"}`}>
                      {slot.participantTotal}/6명 · {slot.full ? "만석" : `잔여 ${slot.remaining}명`}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {slot.reservations.map((reservation) => (
                      <div key={reservation.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                        {/* Desktop row */}
                        <div className="hidden items-center gap-3 sm:grid sm:grid-cols-[1.1fr_0.9fr_0.9fr_0.7fr_1.2fr_0.7fr_auto_auto]">
                          <span className="font-semibold text-[#241b35]">{reservation.name}</span>
                          <span className="text-sm text-slate-600">{reservation.department}</span>
                          <span className="text-sm text-slate-600">{reservation.student_number}</span>
                          <span className="text-sm font-semibold text-[#4B3B71]">{reservation.participant_count}명</span>
                          <span className="truncate text-xs text-slate-400">{reservation.reservation_number}</span>
                          <span className="text-xs font-semibold text-[#4B3B71]">{getStatusLabel(reservation.status)}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-full"
                            onClick={() => setEditingId((prev) => (prev === reservation.id ? null : reservation.id))}
                          >
                            수정
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => setDeleteTarget(reservation)}
                            disabled={isDeleting}
                          >
                            삭제
                          </Button>
                        </div>

                        {/* Mobile card */}
                        <div className="flex flex-col gap-1 sm:hidden">
                          <span className="text-base font-semibold text-[#241b35]">{reservation.name}</span>
                          <span className="text-sm text-slate-600">
                            {reservation.department} · {reservation.student_number}
                          </span>
                          <span className="text-sm font-semibold text-[#4B3B71]">예약 인원 {reservation.participant_count}명</span>
                          <span className="text-xs text-slate-400">{reservation.reservation_number}</span>
                          <span className="text-xs font-semibold text-[#4B3B71]">{getStatusLabel(reservation.status)}</span>
                          <div className="mt-2 flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="h-11 flex-1 rounded-full"
                              onClick={() => setEditingId((prev) => (prev === reservation.id ? null : reservation.id))}
                            >
                              수정
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-11 flex-1 rounded-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => setDeleteTarget(reservation)}
                              disabled={isDeleting}
                            >
                              삭제
                            </Button>
                          </div>
                        </div>

                        {editingId === reservation.id ? (
                          <form
                            action={adminUpdateReservationAction}
                            className="mt-3 grid gap-2 rounded-2xl bg-slate-50 p-3 md:grid-cols-6"
                          >
                            <input type="hidden" name="reservationId" value={reservation.id} />
                            <div className="grid gap-1 md:col-span-2">
                              <Label htmlFor={`reservationDate-${reservation.id}`}>예약일</Label>
                              <select
                                id={`reservationDate-${reservation.id}`}
                                name="reservationDate"
                                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                                defaultValue={reservation.reservation_date}
                              >
                                {allowedDates.map((option) => (
                                  <option key={`${option.date}-${reservation.id}`} value={option.date}>
                                    {option.date} ({formatDateForDisplay(option.date)})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="grid gap-1">
                              <Label htmlFor={`startTime-${reservation.id}`}>시간대</Label>
                              <select
                                id={`startTime-${reservation.id}`}
                                name="startTime"
                                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                                defaultValue={reservation.start_time}
                              >
                                {TIME_SLOTS.map((timeSlot) => (
                                  <option key={`${timeSlot.value}-${reservation.id}`} value={timeSlot.value}>
                                    {timeSlot.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="grid gap-1">
                              <Label htmlFor={`name-${reservation.id}`}>이름</Label>
                              <Input id={`name-${reservation.id}`} name="name" defaultValue={reservation.name} />
                            </div>
                            <div className="grid gap-1">
                              <Label htmlFor={`department-${reservation.id}`}>학과</Label>
                              <Input id={`department-${reservation.id}`} name="department" defaultValue={reservation.department} />
                            </div>
                            <div className="grid gap-1">
                              <Label htmlFor={`studentNumber-${reservation.id}`}>학번</Label>
                              <Input
                                id={`studentNumber-${reservation.id}`}
                                name="studentNumber"
                                defaultValue={reservation.student_number}
                              />
                            </div>
                            <div className="grid gap-1">
                              <Label htmlFor={`participantCount-${reservation.id}`}>예약 인원</Label>
                              <Input
                                id={`participantCount-${reservation.id}`}
                                name="participantCount"
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={6}
                                step={1}
                                defaultValue={reservation.participant_count}
                              />
                            </div>
                            <div className="flex items-end gap-2">
                              <Button type="submit" className="h-10 rounded-full bg-[#4B3B71] hover:bg-[#3f315d]">
                                저장
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-10 rounded-full"
                                onClick={() => setEditingId(null)}
                              >
                                취소
                              </Button>
                            </div>
                          </form>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}

      {deleteTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-[#241b35]">예약을 삭제하시겠습니까?</h2>
            <div className="mt-4 space-y-1 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p><span className="text-slate-500">예약자:</span> {deleteTarget.name}</p>
              <p><span className="text-slate-500">학과:</span> {deleteTarget.department}</p>
              <p><span className="text-slate-500">학번:</span> {deleteTarget.student_number}</p>
              <p><span className="text-slate-500">예약 인원:</span> {deleteTarget.participant_count}명</p>
              <p><span className="text-slate-500">예약일:</span> {formatFullKoreanDate(deleteTarget.reservation_date)}</p>
              <p><span className="text-slate-500">시간대:</span> {slotLabelFor(deleteTarget.start_time)}</p>
            </div>
            <p className="mt-3 text-xs font-semibold text-red-600">삭제된 예약은 복구할 수 없습니다.</p>
            <form action={deleteAction} className="mt-5 flex justify-end gap-2">
              <input type="hidden" name="reservationId" value={deleteTarget.id} />
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                취소
              </Button>
              <Button
                type="submit"
                className="rounded-full bg-red-600 text-white hover:bg-red-700"
                disabled={isDeleting}
              >
                {isDeleting ? "삭제 중..." : "예약 삭제"}
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
