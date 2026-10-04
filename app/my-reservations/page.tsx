import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoutButton } from "@/components/logout-button";
import { MyReservationsList } from "@/components/my-reservations-list";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { formatTimeRange, getTodayDateKey, isPastTimeSlot, mergeConsecutiveTimeSlots, TIME_SLOTS } from "@/lib/booking";

export const revalidate = 0;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function MyReservationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const todayKey = getTodayDateKey();

  if (process.env.NODE_ENV === "development") {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role, student_number")
      .eq("id", user.id)
      .maybeSingle();

    console.info("my_reservations_diagnostic_identity", {
      authUserId: user.id,
      profileId: profile?.id ?? null,
      profileRole: profile?.role ?? null,
      profileFound: Boolean(profile),
      studentNumberSuffix: profile?.student_number?.slice(-2) ?? null,
      error: profileError
        ? { code: profileError.code, message: profileError.message }
        : null,
    });

    const userRows = await supabase
      .from("reservations")
      .select("user_id")
      .eq("user_id", user.id);
    console.info("my_reservations_diagnostic_stage", {
      stage: "user_id",
      count: userRows.data?.length ?? null,
      error: userRows.error ? { code: userRows.error.code, message: userRows.error.message } : null,
    });

    const activeRows = await supabase
      .from("reservations")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("status", "active");
    console.info("my_reservations_diagnostic_stage", {
      stage: "user_id + status=active",
      count: activeRows.data?.length ?? null,
      error: activeRows.error ? { code: activeRows.error.code, message: activeRows.error.message } : null,
    });

    const studentRows = await supabase
      .from("reservations")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .eq("created_by_admin", false);
    console.info("my_reservations_diagnostic_stage", {
      stage: "user_id + status=active + created_by_admin=false",
      count: studentRows.data?.length ?? null,
      error: studentRows.error ? { code: studentRows.error.code, message: studentRows.error.message } : null,
    });

    const upcomingRows = await supabase
      .from("reservations")
      .select("user_id, reservation_date, start_time, status, created_by_admin")
      .eq("user_id", user.id)
      .eq("status", "active")
      .eq("created_by_admin", false)
      .gte("reservation_date", todayKey);
    console.info("my_reservations_diagnostic_stage", {
      stage: "user_id + status=active + created_by_admin=false + reservation_date>=today(KST)",
      todayKey,
      count: upcomingRows.data?.length ?? null,
      rows: upcomingRows.data?.map((row) => ({
        user_id: row.user_id,
        reservation_date: row.reservation_date,
        start_time: row.start_time,
        status: row.status,
        created_by_admin: row.created_by_admin,
      })),
      error: upcomingRows.error
        ? { code: upcomingRows.error.code, message: upcomingRows.error.message }
        : null,
    });
  }

  // Only ACTIVE reservations from today onward are relevant to a student --
  // a cancelled one must never reappear after a refresh, and anything
  // before today is history the student can no longer act on, so both are
  // excluded at the query level rather than filtered client-side.
  const { data: reservationRows, error: reservationsError } = await supabase
    .from("reservations")
    .select("reservation_number, reservation_date, start_time, participant_count, user_id, status, created_by_admin")
    .eq("user_id", user.id)
    .eq("created_by_admin", false)
    .eq("status", "active")
    .gte("reservation_date", todayKey)
    .order("reservation_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (reservationsError) {
    if (process.env.NODE_ENV === "development") {
      console.error("my_reservations_query_failed", {
        currentUserId: user.id,
        todayKey,
        code: reservationsError.code,
        message: reservationsError.message,
        details: reservationsError.details,
        hint: reservationsError.hint,
      });
    }
    throw new Error("내 예약 목록을 불러오지 못했습니다.");
  }

  if (process.env.NODE_ENV === "development") {
    console.info("[my-reservations] fetched reservations", {
      count: reservationRows?.length ?? 0,
      reservations: reservationRows?.map(({ reservation_date, start_time }) => ({ reservation_date, start_time })),
    });
  }

  const upcomingReservations = reservationRows ?? [];
  const todayReservations = upcomingReservations.filter((row) => row.reservation_date === todayKey);

  // Today's summary reflects everything booked today, started or not -- an
  // at-a-glance "what I have today" overview, separate from the actionable
  // list below.
  const todaySlotRanges = todayReservations.reduce<{ start: string; end: string }[]>((acc, row) => {
      const slot = TIME_SLOTS.find((item) => item.value === row.start_time);
      if (slot) {
        acc.push({ start: slot.start, end: slot.end });
      }
      return acc;
    }, []);
  const todayRanges = mergeConsecutiveTimeSlots(todaySlotRanges).map(formatTimeRange);

  // Future dates always remain in the list; only today's rows are checked
  // against the current time before being shown as actionable reservations.
  const visibleReservations = upcomingReservations.filter(
    (row) =>
      row.reservation_date > todayKey ||
      (row.reservation_date === todayKey && !isPastTimeSlot(row.reservation_date, row.start_time)),
  );

  if (process.env.NODE_ENV === "development") {
    console.info("my_reservations_filter_diagnostic", {
      queriedCount: upcomingReservations.length,
      todayCount: todayReservations.length,
      visibleCount: visibleReservations.length,
      visibleSlots: visibleReservations.map(({ reservation_date, start_time }) => ({ reservation_date, start_time })),
    });
    console.info("[my-reservations] props reservations", {
      count: visibleReservations.length,
      reservations: visibleReservations.map(({ reservation_date, start_time }) => ({ reservation_date, start_time })),
    });
  }

  return (
    <main className="min-h-screen bg-[#f8f4ff] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <header className="flex items-center justify-between rounded-full border border-[#4B3B71]/10 bg-white/90 px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-[#4B3B71]">내 예약</p>
            <p className="text-base font-bold">예약 내역을 확인하세요</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href="/booking">예약하기</Link>
            </Button>
            <LogoutButton className="rounded-full" />
          </div>
        </header>

        <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>오늘 예약했어요</CardTitle>
          </CardHeader>
          <CardContent>
            {todayRanges.length === 0 ? (
              <p className="text-sm text-slate-600">오늘 예약이 없어요.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {todayRanges.map((range) => (
                  <span
                    key={range}
                    className="rounded-full bg-[#f5efff] px-3 py-1.5 text-sm font-semibold text-[#4B3B71]"
                  >
                    {range}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-bold tracking-normal text-[#3f315d] sm:text-xl">예약 목록</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <MyReservationsList initialReservations={visibleReservations} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
