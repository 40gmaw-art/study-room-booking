import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoutButton } from "@/components/logout-button";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

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

  const { data: reservations } = await supabase
    .from("reservations")
    .select("reservation_number, reservation_date, start_time, status, participant_count, created_at, cancelled_at")
    .eq("user_id", user.id)
    .order("reservation_date", { ascending: true })
    .order("start_time", { ascending: true });

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
            <CardTitle>예약 목록</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!reservations?.length ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">예약 내역이 없습니다.</div>
            ) : (
              reservations.map((reservation) => (
                <div key={reservation.reservation_number} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-[#4B3B71]">{reservation.reservation_number}</p>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${reservation.status === "cancelled" ? "bg-slate-100 text-slate-600" : "bg-[#f5efff] text-[#4B3B71]"}`}>
                      {reservation.status === "cancelled" ? "취소됨" : "예정"}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                    <div>날짜: {reservation.reservation_date}</div>
                    <div>시간: {reservation.start_time}</div>
                    <div>예약 인원: {reservation.participant_count}명</div>
                    <div>생성일: {reservation.created_at}</div>
                    <div>취소일: {reservation.cancelled_at ?? "-"}</div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
