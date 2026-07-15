import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAdminSession } from "@/lib/admin-session";

export const revalidate = 0;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Single, shared server-side gate for every /admin/* page except /admin/login
// (which lives outside this route group). Runs before any child page body,
// so a non-admin never receives the admin page's HTML.
//
// Two independent conditions must both hold: profiles.role === 'admin' AND
// a server-verified admin-mode session (only issued by signInAdmin). Either
// check failing (including any lookup error) fails closed to a redirect.
export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
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

  return <>{children}</>;
}
