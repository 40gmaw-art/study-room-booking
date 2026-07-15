import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoutButton } from "@/components/logout-button";
import { MainHeroImage } from "@/components/main-hero-image";
import { createClient } from "@/lib/supabase/server";
import { verifyAdminSession } from "@/lib/admin-session";

export const revalidate = 0;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function heroButtonClass(primary: boolean, extra: string) {
  return primary
    ? `h-11 rounded-full bg-white/95 font-semibold text-[#4B3B71] shadow-sm transition-colors hover:bg-white ${extra}`
    : `h-11 rounded-full border border-white/45 bg-white/15 font-semibold text-white transition-colors hover:bg-white/25 ${extra}`;
}

const heroPrimaryCtaClass =
  "absolute inset-x-4 bottom-5 z-20 h-[52px] rounded-[26px] bg-white text-lg font-semibold text-[#4B3B71] shadow-sm transition-colors hover:bg-white/90 sm:inset-x-8 sm:bottom-6 lg:inset-x-10 lg:bottom-6 lg:h-[56px] lg:rounded-[28px] lg:text-xl";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("role, name, student_number")
      .eq("id", user.id)
      .single();

    profile = data;
  }

  const isLoggedIn = Boolean(user && profile);
  const role = profile?.role;
  // Admin UI requires BOTH: profiles.role === 'admin' AND a server-verified
  // admin-mode session (only issued by signInAdmin via /admin/login). A
  // profile with role='admin' authenticated through the student OTP screen
  // does not get admin UI without separately completing /admin/login.
  const hasAdminSession = role === "admin" ? await verifyAdminSession(user?.id) : false;
  const isAdmin = role === "admin" && hasAdminSession;
  const isStudent = isLoggedIn && !isAdmin;

  const adminMenuLinks = [
    { href: "/admin", label: "관리자 대시보드", primary: true },
    { href: "/admin/reservations", label: "예약 관리", primary: false },
  ];
  const adminMobileButtonCount = adminMenuLinks.length + 1;

  const studentDisplayName = profile?.name?.trim() || "학생 회원";
  const studentDisplayNumber = profile?.student_number?.trim() || "-";

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,_#f8f4ff_0%,_#ffffff_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <section className="overflow-hidden rounded-[2rem] border border-[#4B3B71]/10 bg-white shadow-lg">
          {/* Hero image: brand mark + site name + auth menu only */}
          <div className="relative h-[400px] min-h-[380px] w-full overflow-hidden sm:h-[480px] lg:h-[560px] lg:min-h-[520px]">
            <MainHeroImage />
            {/* Scrim covers only the header band so the centered brand mark stays crisp */}
            <div className="absolute inset-x-0 top-0 z-10 h-2/5 bg-gradient-to-b from-[#160f2b]/75 via-[#160f2b]/25 to-transparent" />

            {/* Site name: always top-left */}
            <div className="absolute left-4 top-4 z-20 max-w-[62%] sm:left-6 sm:top-6 sm:max-w-[70%] lg:left-8 lg:top-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/85">
                가천대학교 제40대 경영대학
              </p>
              <h2 className="mt-1 text-lg font-bold leading-tight text-white drop-shadow-sm sm:text-xl lg:text-2xl">
                공명 스터디룸 예약
              </h2>
            </div>

            {isAdmin ? (
              <div className="absolute right-4 top-4 z-20 hidden flex-wrap items-center justify-end gap-2.5 sm:right-6 sm:top-6 sm:flex lg:right-8 lg:top-8">
                {adminMenuLinks.map((item) => (
                  <Button key={item.href} asChild className={heroButtonClass(item.primary, "min-w-[104px] px-5 text-sm")}>
                    <Link href={item.href}>{item.label}</Link>
                  </Button>
                ))}
                <LogoutButton className={heroButtonClass(false, "min-w-[88px] px-5 text-sm")} />
              </div>
            ) : isStudent ? (
              <>
                {/* Student: profile chip + small logout, hero top-right (own info only) */}
                <div className="absolute right-4 top-4 z-20 flex max-w-[42%] flex-col items-end gap-1.5 sm:right-6 sm:top-6 sm:max-w-[55%] lg:right-8 lg:top-8">
                  <div className="rounded-2xl border border-white/35 bg-white/15 px-3 py-1.5 text-right text-white backdrop-blur-sm">
                    <p className="text-xs font-semibold leading-tight sm:hidden">{studentDisplayName}</p>
                    <p className="text-xs font-semibold leading-tight sm:hidden">{studentDisplayNumber}</p>
                    <p className="hidden text-sm font-semibold leading-tight sm:block">
                      {studentDisplayName} · {studentDisplayNumber}
                    </p>
                  </div>
                  <LogoutButton className="h-8 rounded-full border border-white/40 bg-white/10 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-white/20" />
                </div>

                {/* Student: wide primary CTA, hero bottom */}
                <Button asChild className={heroPrimaryCtaClass}>
                  <Link href="/booking">예약하기</Link>
                </Button>
              </>
            ) : (
              <>
                {/* Guest: small outline button, hero top-right, separate from the student CTA */}
                <Button
                  asChild
                  className="absolute right-4 top-4 z-20 h-10 rounded-full border border-white/50 bg-white/10 px-3.5 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20 sm:right-6 sm:top-6 lg:right-8 lg:top-8"
                >
                  <Link href="/admin/login">관리자</Link>
                </Button>

                {/* Guest: wide primary CTA, hero bottom */}
                <Button asChild className={heroPrimaryCtaClass}>
                  <Link href="/login">학생 로그인</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile-only menu strip, directly below the hero image (admin only) */}
          {isAdmin ? (
            <div
              className={`grid grid-cols-2 gap-2 bg-gradient-to-r from-[#3F315D] to-[#4B3B71] p-4 sm:hidden ${
                adminMobileButtonCount % 2 === 1 ? "[&>*:last-child]:col-span-2" : ""
              }`}
            >
              {adminMenuLinks.map((item) => (
                <Button key={item.href} asChild className={heroButtonClass(item.primary, "w-full px-3 text-xs")}>
                  <Link href={item.href}>{item.label}</Link>
                </Button>
              ))}
              <LogoutButton className={heroButtonClass(false, "w-full px-3 text-xs")} />
            </div>
          ) : null}

          {/* Page content below hero */}
          <div className="p-6 sm:p-8 lg:p-10">
            <div className="inline-flex rounded-full bg-[#f5efff] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#4B3B71]">
              경영대학 스터디룸 예약
            </div>
            <h1 className="mt-4 text-[28px] font-bold leading-[1.25] tracking-tight text-[#241b35] sm:text-4xl sm:leading-tight lg:text-5xl">
              원하는 날짜와 시간에
              <br />
              스터디룸을 예약하세요.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
              <span className="block">평일 중 원하는 시간대를 선택해 예약할 수 있습니다.</span>
              <span className="block">예약 확인부터 취소까지, 한곳에서 모두 해결하세요.</span>
            </p>
            <div className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[#f5efff] px-3.5 py-1.5 text-sm font-semibold text-[#4B3B71]">
              <span aria-hidden>📍</span>
              <span>스터디룸 : 글로벌경영학과 과실 B107-6</span>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                className="h-12 w-full rounded-full bg-[#4B3B71] px-8 text-base font-semibold shadow-md shadow-[#4B3B71]/25 transition-shadow hover:bg-[#3f315d] hover:shadow-lg sm:w-auto"
              >
                <Link href={isAdmin ? "/admin" : isLoggedIn ? "/booking" : "/login"}>로그인하고 예약하기</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 w-full rounded-full border-2 border-[#4B3B71]/20 px-8 text-base font-semibold text-[#4B3B71] hover:bg-[#f5efff] sm:w-auto"
              >
                <Link href={isAdmin ? "/admin/reservations" : "/cancel"}>예약 조회·취소</Link>
              </Button>
            </div>

            <div className="mt-10 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <Card className="border-[#4B3B71]/10 bg-[#f8f4ff] shadow-sm">
                <CardHeader>
                  <CardTitle className="text-[#241b35]">운영일 및 예약 안내</CardTitle>
                  <CardDescription>평일만 예약 가능하고, 다음 주 금요일까지 이용할 수 있습니다.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-white p-3">
                    <p className="text-sm text-slate-500">운영일</p>
                    <p className="text-xl font-bold text-[#4B3B71]">월–금</p>
                  </div>
                  <div className="rounded-2xl bg-white p-3">
                    <p className="text-sm text-slate-500">예약 범위</p>
                    <p className="text-xl font-bold text-[#4B3B71]">오늘~다음 주 금요일</p>
                  </div>
                  <div className="rounded-2xl bg-white p-3">
                    <p className="text-sm text-slate-500">이용 안내</p>
                    <p className="text-xl font-bold text-[#4B3B71]">주말 예약 불가</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
                <CardHeader>
                  <CardTitle className="text-[#241b35]">이용 방법</CardTitle>
                  <CardDescription>학생 로그인 후 간단하게 예약하고 관리할 수 있습니다.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-600">
                  <div className="rounded-2xl bg-[#f8f4ff] p-3">1. 학생 로그인</div>
                  <div className="rounded-2xl bg-[#f8f4ff] p-3">2. 예약 가능한 날짜와 시간대 선택</div>
                  <div className="rounded-2xl bg-[#f8f4ff] p-3">3. 예약 확인 후 완료</div>
                  <div className="rounded-2xl bg-[#f8f4ff] p-3">4. 내 예약에서 상태 확인</div>
                  <div className="rounded-2xl bg-[#f8f4ff] p-3">5. 필요 시 예약 취소</div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
