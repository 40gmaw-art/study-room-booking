"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminCreateReservationAction,
  adminDeleteReservationAction,
  adminDeleteReservationGroupAction,
  adminUpdateReservationAction,
  adminUpdateReservationGroupAction,
  type AdminCreateReservationState,
  type AdminDeleteReservationGroupState,
  type AdminUpdateReservationGroupState,
} from "@/lib/booking-actions";
import { formatDateForDisplay, getStatusLabel, MAX_PARTICIPANTS, MIN_PARTICIPANTS, TIME_SLOTS } from "@/lib/booking";
import {
  type AdminBookingGroup,
  type AdminReservationRow,
  formatFullKoreanDate,
  formatFullKoreanDateWithWeekday,
  groupReservationsIntoBookings,
  slotLabelFor,
} from "@/lib/admin-reservations";

const initialDeleteState = { success: false as boolean, message: "", reservationId: "" };
const initialCreateState: AdminCreateReservationState = { success: false, message: "", reservation: null };
const initialGroupUpdateState: AdminUpdateReservationGroupState = { success: false, message: "" };
const initialGroupDeleteState: AdminDeleteReservationGroupState = { success: false, message: "", reservationIds: [] };

export function AdminReservationManager({
  initialReservations,
  allowedDates,
}: {
  initialReservations: AdminReservationRow[];
  allowedDates: Array<{ date: string }>;
}) {
  const router = useRouter();
  const [reservations, setReservations] = useState(initialReservations);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminReservationRow | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [deleteState, deleteAction, isDeleting] = useActionState(adminDeleteReservationAction, initialDeleteState);

  // Merged (multi-slot) booking cards use their own edit/delete state,
  // separate from the single-row ones above -- a card is only ever handled
  // by one path or the other (see the reservations.length === 1 branch
  // below), so these never interact with editingId/deleteTarget/deleteState.
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<AdminBookingGroup | null>(null);
  const [groupUpdateState, groupUpdateAction, isGroupUpdating] = useActionState(
    adminUpdateReservationGroupAction,
    initialGroupUpdateState,
  );
  const [groupDeleteState, groupDeleteAction, isGroupDeleting] = useActionState(
    adminDeleteReservationGroupAction,
    initialGroupDeleteState,
  );

  const [createDate, setCreateDate] = useState(allowedDates[0]?.date ?? "");
  const [createStartTime, setCreateStartTime] = useState<string>(TIME_SLOTS[0].value);
  const [createName, setCreateName] = useState("");
  const [createDepartment, setCreateDepartment] = useState("");
  const [createStudentNumber, setCreateStudentNumber] = useState("");
  const [createParticipantCount, setCreateParticipantCount] = useState("1");
  const [createState, createAction, isCreating] = useActionState(adminCreateReservationAction, initialCreateState);

  const grouped = useMemo(() => groupReservationsIntoBookings(reservations), [reservations]);

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

  useEffect(() => {
    if (!groupUpdateState.message) {
      return;
    }

    setFeedback({ tone: groupUpdateState.success ? "success" : "error", text: groupUpdateState.message });

    if (groupUpdateState.success) {
      setEditingGroupKey(null);
      // The group action updates every underlying row on the server but
      // doesn't return the updated rows, so pull fresh data from the
      // server (this page is force-dynamic) rather than reconstructing it
      // client-side.
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupUpdateState]);

  useEffect(() => {
    if (groupDeleteState.reservationIds.length === 0) {
      return;
    }

    const deletedIds = new Set(groupDeleteState.reservationIds);
    setReservations((prev) => prev.filter((row) => !deletedIds.has(row.id)));

    if (groupDeleteState.success) {
      setDeleteGroupTarget(null);
      setFeedback({ tone: "success", text: groupDeleteState.message || "예약이 삭제되었습니다." });
    } else {
      setDeleteGroupTarget(null);
      setFeedback({ tone: "error", text: groupDeleteState.message || "예약 삭제에 실패했습니다." });
    }
  }, [groupDeleteState]);

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
                min={MIN_PARTICIPANTS}
                max={MAX_PARTICIPANTS}
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
                총 예약 {dateGroup.bookings.length}건 · 예약된 시간대 {dateGroup.totalReservationCount}개
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {dateGroup.bookings.map((booking) =>
                booking.reservations.length === 1 ? (
                  <div key={booking.key} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="mb-2 font-semibold text-[#241b35]">{booking.label}</div>
                    {/* Desktop row */}
                    <div className="hidden items-center gap-3 sm:grid sm:grid-cols-[1.1fr_0.9fr_0.9fr_0.7fr_0.7fr_auto_auto]">
                      <span className="font-semibold text-[#241b35]">{booking.name}</span>
                      <span className="text-sm text-slate-600">{booking.department}</span>
                      <span className="text-sm text-slate-600">{booking.student_number}</span>
                      <span className="text-sm font-semibold text-[#4B3B71]">{booking.participant_count}명</span>
                      <span className="text-xs font-semibold text-[#4B3B71]">{getStatusLabel(booking.status)}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => setEditingId((prev) => (prev === booking.reservations[0].id ? null : booking.reservations[0].id))}
                      >
                        수정
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setDeleteTarget(booking.reservations[0])}
                        disabled={isDeleting}
                      >
                        삭제
                      </Button>
                    </div>

                    {/* Mobile card */}
                    <div className="flex flex-col gap-1 sm:hidden">
                      <span className="text-base font-semibold text-[#241b35]">{booking.name}</span>
                      <span className="text-sm text-slate-600">
                        {booking.department} · {booking.student_number}
                      </span>
                      <span className="text-sm font-semibold text-[#4B3B71]">예약 인원 {booking.participant_count}명</span>
                      <span className="text-xs font-semibold text-[#4B3B71]">{getStatusLabel(booking.status)}</span>
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 flex-1 rounded-full"
                          onClick={() => setEditingId((prev) => (prev === booking.reservations[0].id ? null : booking.reservations[0].id))}
                        >
                          수정
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 flex-1 rounded-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setDeleteTarget(booking.reservations[0])}
                          disabled={isDeleting}
                        >
                          삭제
                        </Button>
                      </div>
                    </div>

                    {editingId === booking.reservations[0].id ? (
                      <form
                        action={adminUpdateReservationAction}
                        className="mt-3 grid gap-2 rounded-2xl bg-slate-50 p-3 md:grid-cols-6"
                      >
                        <input type="hidden" name="reservationId" value={booking.reservations[0].id} />
                        <div className="grid gap-1 md:col-span-2">
                          <Label htmlFor={`reservationDate-${booking.key}`}>예약일</Label>
                          <select
                            id={`reservationDate-${booking.key}`}
                            name="reservationDate"
                            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                            defaultValue={booking.reservations[0].reservation_date}
                          >
                            {allowedDates.map((option) => (
                              <option key={`${option.date}-${booking.key}`} value={option.date}>
                                {option.date} ({formatDateForDisplay(option.date)})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor={`startTime-${booking.key}`}>시간대</Label>
                          <select
                            id={`startTime-${booking.key}`}
                            name="startTime"
                            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                            defaultValue={booking.reservations[0].start_time}
                          >
                            {TIME_SLOTS.map((timeSlot) => (
                              <option key={`${timeSlot.value}-${booking.key}`} value={timeSlot.value}>
                                {timeSlot.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor={`name-${booking.key}`}>이름</Label>
                          <Input id={`name-${booking.key}`} name="name" defaultValue={booking.reservations[0].name} />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor={`department-${booking.key}`}>학과</Label>
                          <Input
                            id={`department-${booking.key}`}
                            name="department"
                            defaultValue={booking.reservations[0].department}
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor={`studentNumber-${booking.key}`}>학번</Label>
                          <Input
                            id={`studentNumber-${booking.key}`}
                            name="studentNumber"
                            defaultValue={booking.reservations[0].student_number}
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor={`participantCount-${booking.key}`}>예약 인원</Label>
                          <Input
                            id={`participantCount-${booking.key}`}
                            name="participantCount"
                            type="number"
                            inputMode="numeric"
                            min={MIN_PARTICIPANTS}
                            max={MAX_PARTICIPANTS}
                            step={1}
                            defaultValue={booking.reservations[0].participant_count}
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
                ) : (
                  <div key={booking.key} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="mb-2 font-semibold text-[#241b35]">{booking.label}</div>
                    {/* Desktop row */}
                    <div className="hidden items-center gap-3 sm:grid sm:grid-cols-[1.1fr_0.9fr_0.9fr_0.7fr_0.7fr_auto_auto]">
                      <span className="font-semibold text-[#241b35]">{booking.name}</span>
                      <span className="text-sm text-slate-600">{booking.department}</span>
                      <span className="text-sm text-slate-600">{booking.student_number}</span>
                      <span className="text-sm font-semibold text-[#4B3B71]">{booking.participant_count}명</span>
                      <span className="text-xs font-semibold text-[#4B3B71]">{getStatusLabel(booking.status)}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => setEditingGroupKey((prev) => (prev === booking.key ? null : booking.key))}
                      >
                        수정
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setDeleteGroupTarget(booking)}
                        disabled={isGroupDeleting}
                      >
                        삭제
                      </Button>
                    </div>

                    {/* Mobile card */}
                    <div className="flex flex-col gap-1 sm:hidden">
                      <span className="text-base font-semibold text-[#241b35]">{booking.name}</span>
                      <span className="text-sm text-slate-600">
                        {booking.department} · {booking.student_number}
                      </span>
                      <span className="text-sm font-semibold text-[#4B3B71]">예약 인원 {booking.participant_count}명</span>
                      <span className="text-xs font-semibold text-[#4B3B71]">{getStatusLabel(booking.status)}</span>
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 flex-1 rounded-full"
                          onClick={() => setEditingGroupKey((prev) => (prev === booking.key ? null : booking.key))}
                        >
                          수정
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 flex-1 rounded-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setDeleteGroupTarget(booking)}
                          disabled={isGroupDeleting}
                        >
                          삭제
                        </Button>
                      </div>
                    </div>

                    {editingGroupKey === booking.key ? (
                      <form
                        action={groupUpdateAction}
                        className="mt-3 grid gap-2 rounded-2xl bg-slate-50 p-3 md:grid-cols-6"
                      >
                        {booking.reservations.map((row) => (
                          <input key={`id-${row.id}`} type="hidden" name="reservationIds" value={row.id} />
                        ))}
                        {booking.reservations.map((row) => (
                          <input key={`date-${row.id}`} type="hidden" name="reservationDates" value={row.reservation_date} />
                        ))}
                        {booking.reservations.map((row) => (
                          <input key={`time-${row.id}`} type="hidden" name="startTimes" value={row.start_time} />
                        ))}
                        <div className="grid gap-1 md:col-span-2">
                          <Label>예약일 · 시간대</Label>
                          <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-100 px-3 text-sm text-slate-500">
                            {formatDateForDisplay(booking.reservations[0].reservation_date)} · {booking.label}
                          </div>
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor={`group-name-${booking.key}`}>이름</Label>
                          <Input id={`group-name-${booking.key}`} name="name" defaultValue={booking.name} />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor={`group-department-${booking.key}`}>학과</Label>
                          <Input id={`group-department-${booking.key}`} name="department" defaultValue={booking.department} />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor={`group-studentNumber-${booking.key}`}>학번</Label>
                          <Input
                            id={`group-studentNumber-${booking.key}`}
                            name="studentNumber"
                            defaultValue={booking.student_number}
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor={`group-participantCount-${booking.key}`}>예약 인원</Label>
                          <Input
                            id={`group-participantCount-${booking.key}`}
                            name="participantCount"
                            type="number"
                            inputMode="numeric"
                            min={MIN_PARTICIPANTS}
                            max={MAX_PARTICIPANTS}
                            step={1}
                            defaultValue={booking.participant_count}
                          />
                        </div>
                        <div className="flex items-end gap-2">
                          <Button type="submit" className="h-10 rounded-full bg-[#4B3B71] hover:bg-[#3f315d]" disabled={isGroupUpdating}>
                            {isGroupUpdating ? "저장 중..." : "저장"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 rounded-full"
                            onClick={() => setEditingGroupKey(null)}
                          >
                            취소
                          </Button>
                        </div>
                        <p className="text-xs text-slate-500 md:col-span-6">
                          {booking.reservations.length}개 시간대가 합쳐진 예약이라 이름·학과·학번·예약 인원만 한 번에 수정됩니다.
                          날짜/시간을 바꾸려면 개별 시간대 단위로 문의해 주세요.
                        </p>
                      </form>
                    ) : null}
                  </div>
                ),
              )}
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

      {deleteGroupTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-[#241b35]">예약을 삭제하시겠습니까?</h2>
            <div className="mt-4 space-y-1 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p><span className="text-slate-500">예약자:</span> {deleteGroupTarget.name}</p>
              <p><span className="text-slate-500">학과:</span> {deleteGroupTarget.department}</p>
              <p><span className="text-slate-500">학번:</span> {deleteGroupTarget.student_number}</p>
              <p><span className="text-slate-500">예약 인원:</span> {deleteGroupTarget.participant_count}명</p>
              <p><span className="text-slate-500">예약일:</span> {formatFullKoreanDate(deleteGroupTarget.reservations[0].reservation_date)}</p>
              <p><span className="text-slate-500">시간대:</span> {deleteGroupTarget.label} ({deleteGroupTarget.reservations.length}개 시간대)</p>
            </div>
            <p className="mt-3 text-xs font-semibold text-red-600">
              합쳐진 {deleteGroupTarget.reservations.length}개 시간대가 모두 함께 삭제됩니다. 삭제된 예약은 복구할 수 없습니다.
            </p>
            <form action={groupDeleteAction} className="mt-5 flex justify-end gap-2">
              {deleteGroupTarget.reservations.map((row) => (
                <input key={row.id} type="hidden" name="reservationIds" value={row.id} />
              ))}
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setDeleteGroupTarget(null)}
                disabled={isGroupDeleting}
              >
                취소
              </Button>
              <Button
                type="submit"
                className="rounded-full bg-red-600 text-white hover:bg-red-700"
                disabled={isGroupDeleting}
              >
                {isGroupDeleting ? "삭제 중..." : "예약 삭제"}
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
