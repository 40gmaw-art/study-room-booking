import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoutButton } from "@/components/logout-button";
import { createClient } from "@/lib/supabase/server";
import { countFullSlots, groupReservationsIntoBookings, sumParticipants } from "@/lib/admin-reservations";
import { getSeoulDateParts } from "@/lib/booking";

export const revalidate = 0;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminPage() {
  const supabase = await createClient();

  const { data: reservations } = await supabase
    .from("reservations")
    .select(
      "id, reservation_number, reservation_date, start_time, name, department, student_number, status, participant_count, user_id, created_at",
    )
    .eq("status", "active");

  const rows = reservations ?? [];
  // "예약 건수"(rows) and "예약 인원"(participant_count sum) are intentionally
  // separate numbers -- a single reservation row can represent up to 6 people.
  const totalReservationCount = rows.length;
  const totalParticipantCount = sumParticipants(rows);

  const todayParts = getSeoulDateParts();
  const todayKey = `${todayParts.year}-${String(todayParts.month).padStart(2, "0")}-${String(todayParts.day).padStart(2, "0")}`;
  const todayReservationCount = rows.filter((row) => row.reservation_date === todayKey).length;

  const fullSlotCount = countFullSlots(rows);

  // Reuses the same merge logic as the "예약 관리" screen so a bulk booking's
  // consecutive hours (e.g. 13:00~14:00 + 14:00~15:00) show as one range
  // ("13:00 ~ 15:00") here too, instead of one line per 1-hour row.
  const todayBookings = groupReservationsIntoBookings(rows).find((group) => group.date === todayKey)?.bookings ?? [];

  return (
    <main className="min-h-screen bg-[#f8f4ff] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <header className="flex items-center justify-between rounded-full border border-[#4B3B71]/10 bg-white/90 px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-[#4B3B71]">관리자 대시보드</p>
            <p className="text-base font-bold">예약 현황을 확인하고 관리합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href="/admin/reservations">예약 관리</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href="/" prefetch={false}>홈</Link>
            </Button>
            <LogoutButton className="rounded-full" />
          </div>
        </header>

        <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
          <CardContent className="p-6">
            {todayBookings.length > 0 ? (
              <>
                <p className="text-2xl font-bold text-[#4B3B71] sm:text-3xl">오늘 예약이 있습니다.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {todayBookings.map((booking) => (
                    <span
                      key={booking.key}
                      className="rounded-full bg-[#f5efff] px-4 py-2 text-base font-semibold text-[#4B3B71] sm:text-lg"
                    >
                      {booking.label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-2xl font-bold text-slate-400 sm:text-3xl">오늘 예약이 없습니다.</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
            <CardHeader>
              <CardTitle>전체 예약 건수</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold text-[#4B3B71]">{totalReservationCount}</CardContent>
          </Card>
          <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
            <CardHeader>
              <CardTitle>전체 예약 인원</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold text-[#4B3B71]">{totalParticipantCount}명</CardContent>
          </Card>
          <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
            <CardHeader>
              <CardTitle>오늘 예약 건수</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold text-[#4B3B71]">{todayReservationCount}</CardContent>
          </Card>
          <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
            <CardHeader>
              <CardTitle>만석 시간대</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold text-[#4B3B71]">{fullSlotCount}</CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
