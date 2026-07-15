import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentLoginForm } from "@/components/student-login-form";
import { createClient } from "@/lib/supabase/server";
import { verifyAdminSession } from "@/lib/admin-session";

export const revalidate = 0;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function StudentLoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const isFullAdmin = profile?.role === "admin" && (await verifyAdminSession(user.id));
    redirect(isFullAdmin ? "/admin" : "/booking");
  }

  return (
    <main className="min-h-screen bg-[#f8f4ff] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-2xl">학생 로그인</CardTitle>
            <CardDescription>가천대학교 이메일로 인증번호를 받아 로그인합니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <StudentLoginForm />
            <div className="mt-4 flex flex-col gap-2 text-sm text-slate-600">
              <Link href="/admin/login" className="font-medium text-[#4B3B71]">관리자 로그인</Link>
              <Link href="/" prefetch={false} className="font-medium text-[#4B3B71]">메인으로</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
