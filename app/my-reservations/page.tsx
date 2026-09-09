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

  // Only ACTIVE reservations from today onward are relevant to a student --
  // a cancelled one must never reappear after a refresh, and anything
  // before today is history the student can no longer act on, so both are
  // excluded at the query level rather than filtered client-side.
  const { data: reservations } = await supabase
    .from("reservations")
    .select("reservation_number, reservation_date, start_time, participant_count")
    .eq("user_id", user.id)
    .eq("status", "active")
    .gte("reservation_date", todayKey)
    .order("reservation_date", { ascending: true })
    .order("start_time", { ascending: true });

  const upcoming = reservations ?? [];

  // Today's summary reflects everything booked today, started or not -- an
  // at-a-glance "what I have today" overview, separate from the actionable
  // list below.
  const todaySlotRanges = upcoming
    .filter((row) => row.reservation_date === todayKey)
    .reduce<{ start: string; end: string }[]>((acc, row) => {
      const slot = TIME_SLOTS.find((item) => item.value === row.start_time);
      if (slot) {
        acc.push({ start: slot.start, end: slot.end });
      }
      return acc;
    }, []);
  const todayRanges = mergeConsecutiveTimeSlots(todaySlotRanges).map(formatTimeRange);

  // The actionable list below excludes anything whose start time has
  // already passed -- reuses the same isPastTimeSlot() the booking page
  // uses, which is a no-op (always false) for any future date and only
  // matters for today's rows.
  const visibleReservations = upcoming.filter((row) => !isPastTimeSlot(row.reservation_date, row.start_time));

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
            <CardTitle>예약 목록</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <MyReservationsList initialReservations={visibleReservations} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
