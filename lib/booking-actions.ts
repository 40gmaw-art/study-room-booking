"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBookingDateValidation, getBookingDates, MAX_PARTICIPANTS, MAX_TIME_SLOTS_PER_RESERVATION, MIN_PARTICIPANTS, parseParticipantCount, TIME_SLOTS } from "@/lib/booking";
import { verifyAdminSession } from "@/lib/admin-session";
import { formatFullKoreanDate, slotLabelFor, type AdminReservationRow } from "@/lib/admin-reservations";

// Shared guard for every admin-only write action below. Re-checks the
// CURRENT session's profiles.role AND the signed admin-mode session cookie
// on every call (never trusts that the caller reached this action through an
// admin-only page) so a non-admin, or an admin who never completed
// /admin/login, is redirected away instead of writing data.
async function requireAdminOrRedirect(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error || !profile || profile.role !== "admin") {
    redirect("/");
  }

  const hasAdminSession = await verifyAdminSession(user.id);
  if (!hasAdminSession) {
    redirect("/admin/login");
  }
}

// Server actions never return raw Error/Response/Supabase-error objects to
// the client -- only plain serializable {success, message} shapes. Our own
// RPCs already raise clear, safe Korean messages (capacity, date/time
// validity, admin-only checks, etc.), so those are surfaced as-is; only the
// "function not found" schema-cache class of error (an English PostgREST
// message, not one of ours) is replaced with a generic Korean message.
function describeReservationRpcError(error: { message?: string; code?: string } | null | undefined): string {
  const message = error?.message ?? "";

  if (/Could not find the function|schema cache/i.test(message)) {
    console.error("reservation_rpc_missing_function", { code: error?.code, message });
    return "예약 처리 함수를 찾을 수 없습니다. 관리자에게 문의해 주세요.";
  }

  if (message) {
    return message;
  }

  console.error("reservation_rpc_unknown_error", { code: error?.code });
  return "예약 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}

export async function createReservationsBulkAction(prevState: unknown, formData: FormData) {
  const date = String(formData.get("reservationDate") || "");
  const times = Array.from(new Set(formData.getAll("startTimes").map((value) => String(value)).filter(Boolean)));
  const participantCount = parseParticipantCount(formData.get("participantCount"));

  const emptyResult = { success: false, message: "", reservations: [] as Array<{ reservation_number: string; start_time: string }> };

  if (!date || times.length === 0) {
    return { ...emptyResult, message: "예약 날짜와 시간대를 선택해 주세요." };
  }

  if (times.length > MAX_TIME_SLOTS_PER_RESERVATION) {
    return { ...emptyResult, message: "한 번에 최대 4시간까지만 예약할 수 있습니다." };
  }

  const dateValidation = getBookingDateValidation(date);
  if (!dateValidation.allowed) {
    return { ...emptyResult, message: dateValidation.message };
  }

  if (times.some((slot) => !TIME_SLOTS.some((timeSlot) => timeSlot.value === slot))) {
    return { ...emptyResult, message: "지원하지 않는 시간대가 포함되어 있습니다." };
  }

  if (participantCount === null) {
    return { ...emptyResult, message: `예약 인원은 ${MIN_PARTICIPANTS}명 이상 ${MAX_PARTICIPANTS}명 이하의 숫자로 입력해 주세요.` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fast-path check for a friendly message before hitting the RPC. This is
  // NOT the authoritative guard against concurrent double-booking (a race
  // between this read and the insert is still possible from two simultaneous
  // requests) -- create_reservations_bulk itself re-checks this same total
  // under a per-user/per-date advisory lock, which is what actually prevents
  // the daily cap from being bypassed.
  const existingActiveSlots = await getMyActiveReservedSlots(date);
  if (existingActiveSlots.length + times.length > MAX_TIME_SLOTS_PER_RESERVATION) {
    return {
      ...emptyResult,
      message: `해당 날짜에는 이미 ${existingActiveSlots.length}시간을 예약하셨습니다. 하루 최대 ${MAX_TIME_SLOTS_PER_RESERVATION}시간까지만 예약할 수 있습니다.`,
    };
  }

  const { data, error } = await supabase.rpc("create_reservations_bulk", {
    p_reservation_date: date,
    p_start_times: times,
    p_name: null,
    p_department: null,
    p_student_number: null,
    p_participant_count: participantCount,
  });

  if (error || !data) {
    return {
      ...emptyResult,
      message: describeReservationRpcError(error),
    };
  }

  const reservations = (data as Array<{ reservation_number: string; start_time: string }>).map((row) => ({
    reservation_number: row.reservation_number,
    start_time: row.start_time,
  }));

  return {
    success: true,
    message: `${reservations.length}개 시간대에 ${participantCount}명으로 예약되었습니다.`,
    reservations,
  };
}

export async function cancelReservationAction(prevState: unknown, formData: FormData) {
  const reservationNumber = String(formData.get("reservationNumber") || "").trim();
  if (!reservationNumber) {
    return { success: false, message: "예약번호를 입력해 주세요." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase.rpc("cancel_reservation", {
    p_reservation_number: reservationNumber,
  });

  if (error || !data) {
    return {
      success: false,
      message: describeReservationRpcError(error),
    };
  }

  return {
    success: true,
    message: "예약이 취소되었습니다.",
    reservationNumber: data.reservation_number,
  };
}

// The current user's own ACTIVE reservations for one date, as start_time
// values (e.g. "10:00:00") matching TIME_SLOTS[].value. Used both to gray
// out/disable slots the user already holds that date, and as the basis for
// the "max 4 hours per user per day" budget check. Scoped to auth.uid() via
// the query filter (matches the reservations_self_select RLS policy), so
// another user's bookings never affect what this caller sees here.
export async function getMyActiveReservedSlots(dateKey: string): Promise<string[]> {
  const dateValidation = getBookingDateValidation(dateKey);
  if (!dateValidation.allowed) {
    return [];
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("reservations")
    .select("start_time")
    .eq("user_id", user.id)
    .eq("reservation_date", dateKey)
    .eq("status", "active");

  if (error || !data) {
    return [];
  }

  return data.map((row) => row.start_time as string);
}

export async function getBookingAvailability(dateKey: string) {
  const dateValidation = getBookingDateValidation(dateKey);
  if (!dateValidation.allowed) {
    return TIME_SLOTS.map((slot) => ({ ...slot, count: 0, full: false }));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_time_slot_counts", {
    p_date: dateKey,
  });

  if (error) {
    return TIME_SLOTS.map((slot) => ({ ...slot, count: 0, full: false }));
  }

  return TIME_SLOTS.map((slot) => {
    const detail = data?.find((item: { start_time: string; active_count: number }) => item.start_time === slot.value);
    // One team per slot: get_time_slot_counts() now returns a row COUNT
    // (0 or 1), not a participant_count sum, so "full" means "someone has
    // an active reservation here" -- regardless of that team's size.
    return {
      ...slot,
      count: Number(detail?.active_count ?? 0),
      full: Number(detail?.active_count ?? 0) >= 1,
    };
  });
}

export async function getAvailableBookingDates() {
  return getBookingDates();
}

export async function getMyReservations() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return [];
  }

  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("user_id", userData.user.id)
    .order("reservation_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data as Array<{
    id: string;
    reservation_number: string;
    reservation_date: string;
    start_time: string;
    status: string;
    participant_count: number;
    created_at: string;
    cancelled_at: string | null;
  }>;
}

export type AdminCreateReservationState = {
  success: boolean;
  message: string;
  reservation: AdminReservationRow | null;
};

export async function adminCreateReservationAction(
  prevState: AdminCreateReservationState,
  formData: FormData,
): Promise<AdminCreateReservationState> {
  const supabase = await createClient();
  await requireAdminOrRedirect(supabase);

  const date = String(formData.get("reservationDate") || "").trim();
  const slot = String(formData.get("startTime") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const department = String(formData.get("department") || "").trim();
  const studentNumber = String(formData.get("studentNumber") || "").trim();
  const participantCount = parseParticipantCount(formData.get("participantCount"));

  const empty: AdminCreateReservationState = { success: false, message: "", reservation: null };

  if (!name) {
    return { ...empty, message: "이름을 입력해 주세요." };
  }

  if (!department) {
    return { ...empty, message: "학과를 입력해 주세요." };
  }

  if (!studentNumber) {
    return { ...empty, message: "학번을 입력해 주세요." };
  }

  const dateValidation = getBookingDateValidation(date);
  if (!dateValidation.allowed) {
    return { ...empty, message: dateValidation.message };
  }

  if (!TIME_SLOTS.some((timeSlot) => timeSlot.value === slot)) {
    return { ...empty, message: "유효하지 않은 시간대입니다." };
  }

  if (participantCount === null) {
    return { ...empty, message: `예약 인원은 ${MIN_PARTICIPANTS}명 이상 ${MAX_PARTICIPANTS}명 이하의 숫자로 입력해 주세요.` };
  }

  const { data, error } = await supabase.rpc("create_reservation", {
    p_reservation_date: date,
    p_start_time: slot,
    p_name: name,
    p_department: department,
    p_student_number: studentNumber,
    p_participant_count: participantCount,
  });

  if (error || !data) {
    return { ...empty, message: describeReservationRpcError(error) };
  }

  const reservation = data as AdminReservationRow;

  return {
    success: true,
    message: `${name}님의 ${formatFullKoreanDate(date)} ${slotLabelFor(slot)} 예약을 ${participantCount}명으로 추가했습니다.`,
    reservation,
  };
}

export async function adminUpdateReservationAction(formData: FormData) {
  const supabase = await createClient();
  await requireAdminOrRedirect(supabase);

  const reservationId = String(formData.get("reservationId") || "");
  const date = String(formData.get("reservationDate") || "");
  const slot = String(formData.get("startTime") || "");
  const dateValidation = getBookingDateValidation(date);

  if (!dateValidation.allowed) {
    return;
  }

  if (!TIME_SLOTS.some((timeSlot) => timeSlot.value === slot)) {
    return;
  }

  const participantCount = parseParticipantCount(formData.get("participantCount"));
  if (participantCount === null) {
    return;
  }

  const { data, error } = await supabase.rpc("update_reservation_admin", {
    p_reservation_id: reservationId,
    p_reservation_date: date,
    p_start_time: slot,
    p_name: String(formData.get("name") || ""),
    p_department: String(formData.get("department") || ""),
    p_student_number: String(formData.get("studentNumber") || ""),
    p_participant_count: participantCount,
  });

  if (!error && data) {
    redirect("/admin/reservations");
  }
}

export async function adminToggleReservationStatusAction(prevState: unknown, formData: FormData) {
  const supabase = await createClient();
  await requireAdminOrRedirect(supabase);

  const reservationId = String(formData.get("reservationId") || "");
  const status = String(formData.get("status") || "active");

  const { error } = await supabase
    .from("reservations")
    .update({
      status,
      cancelled_at: status === "cancelled" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservationId);

  if (error) {
    return { success: false, message: "상태 변경에 실패했습니다." };
  }

  return { success: true, message: "상태가 변경되었습니다." };
}

export async function adminDeleteReservationAction(prevState: unknown, formData: FormData) {
  const supabase = await createClient();
  await requireAdminOrRedirect(supabase);

  const reservationId = String(formData.get("reservationId") || "");
  if (!reservationId) {
    return { success: false, message: "삭제할 예약 정보를 확인할 수 없습니다.", reservationId };
  }

  const { data, error } = await supabase.rpc("admin_delete_reservation", {
    p_reservation_id: reservationId,
  });

  if (error || !data) {
    return {
      success: false,
      message: describeReservationRpcError(error),
      reservationId,
    };
  }

  return { success: true, message: "예약이 삭제되었습니다.", reservationId };
}

// Admin "예약 관리" screen displays consecutive same-booking 1-hour rows as
// one merged time-range card (see lib/admin-reservations.ts
// groupReservationsIntoBookings). Editing/deleting such a card must act on
// every underlying row, not just one -- these two actions loop the SAME
// per-row RPCs used by adminUpdateReservationAction/adminDeleteReservationAction
// above (update_reservation_admin / admin_delete_reservation) once per row
// ID, so no new RPC or DB logic is introduced. A single-row card still uses
// the original single-row actions unchanged; these are only used when a
// card represents more than one row.

export type AdminUpdateReservationGroupState = { success: boolean; message: string };

export async function adminUpdateReservationGroupAction(
  prevState: AdminUpdateReservationGroupState,
  formData: FormData,
): Promise<AdminUpdateReservationGroupState> {
  const supabase = await createClient();
  await requireAdminOrRedirect(supabase);

  const reservationIds = formData.getAll("reservationIds").map((value) => String(value)).filter(Boolean);
  const reservationDates = formData.getAll("reservationDates").map((value) => String(value));
  const startTimes = formData.getAll("startTimes").map((value) => String(value));

  if (reservationIds.length === 0 || reservationIds.length !== reservationDates.length || reservationIds.length !== startTimes.length) {
    return { success: false, message: "수정할 예약 정보를 확인할 수 없습니다." };
  }

  const name = String(formData.get("name") || "").trim();
  const department = String(formData.get("department") || "").trim();
  const studentNumber = String(formData.get("studentNumber") || "").trim();

  if (!name || !department || !studentNumber) {
    return { success: false, message: "이름, 학과, 학번을 모두 입력해 주세요." };
  }

  const participantCount = parseParticipantCount(formData.get("participantCount"));
  if (participantCount === null) {
    return { success: false, message: `예약 인원은 ${MIN_PARTICIPANTS}명 이상 ${MAX_PARTICIPANTS}명 이하의 숫자로 입력해 주세요.` };
  }

  // Each row keeps its own reservation_date/start_time exactly as it was --
  // this form only lets the admin correct the shared person-info fields
  // across every slot in the merged booking, never move/split the time
  // range (that would need a real atomic multi-row RPC, out of scope here).
  for (let i = 0; i < reservationIds.length; i += 1) {
    const dateValidation = getBookingDateValidation(reservationDates[i]);
    if (!dateValidation.allowed) {
      return { success: false, message: dateValidation.message };
    }

    if (!TIME_SLOTS.some((timeSlot) => timeSlot.value === startTimes[i])) {
      return { success: false, message: "지원하지 않는 시간대가 포함되어 있습니다." };
    }

    const { error } = await supabase.rpc("update_reservation_admin", {
      p_reservation_id: reservationIds[i],
      p_reservation_date: reservationDates[i],
      p_start_time: startTimes[i],
      p_name: name,
      p_department: department,
      p_student_number: studentNumber,
      p_participant_count: participantCount,
    });

    if (error) {
      return { success: false, message: describeReservationRpcError(error) };
    }
  }

  return { success: true, message: "예약 정보를 수정했습니다." };
}

export type AdminDeleteReservationGroupState = { success: boolean; message: string; reservationIds: string[] };

export async function adminDeleteReservationGroupAction(
  prevState: AdminDeleteReservationGroupState,
  formData: FormData,
): Promise<AdminDeleteReservationGroupState> {
  const supabase = await createClient();
  await requireAdminOrRedirect(supabase);

  const reservationIds = formData.getAll("reservationIds").map((value) => String(value)).filter(Boolean);
  if (reservationIds.length === 0) {
    return { success: false, message: "삭제할 예약 정보를 확인할 수 없습니다.", reservationIds: [] };
  }

  const deletedIds: string[] = [];
  for (const reservationId of reservationIds) {
    const { data, error } = await supabase.rpc("admin_delete_reservation", {
      p_reservation_id: reservationId,
    });

    if (error || !data) {
      return {
        success: false,
        message: describeReservationRpcError(error),
        reservationIds: deletedIds,
      };
    }

    deletedIds.push(reservationId);
  }

  return { success: true, message: "예약이 삭제되었습니다.", reservationIds: deletedIds };
}
