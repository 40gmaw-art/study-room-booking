import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminLoginForm } from "@/components/admin-login-form";
import { createClient } from "@/lib/supabase/server";
import { verifyAdminSession } from "@/lib/admin-session";

export const revalidate = 0;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminLoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only skip straight to /admin when a full admin-mode session already
  // exists for this exact account. Having profiles.role === 'admin' alone
  // (e.g. from a student OTP login using the same email) is not enough —
  // that case must still complete the form below to establish admin mode.
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role === "admin" && (await verifyAdminSession(user.id))) {
      redirect("/admin");
    }
  }

  return (
    <main className="min-h-screen bg-[#f8f4ff] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-2xl">관리자 로그인</CardTitle>
            <CardDescription>관리자 계정으로만 접근할 수 있습니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminLoginForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
