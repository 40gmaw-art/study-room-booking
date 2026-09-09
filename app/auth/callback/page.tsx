import { ensureProfileAfterLogin } from "@/lib/auth-actions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export const revalidate = 0;

export default async function AuthCallbackPage() {
  await ensureProfileAfterLogin();
  // This is a second, separate session-establishing entry point (alongside
  // verifyStudentOtp/signInAdmin/signOutUser in lib/auth-actions.ts) that
  // was missing the same router-cache bust -- a login completing through
  // here could still leave a stale cached "/" from an earlier session.
  revalidatePath("/", "layout");
  redirect("/booking");
}
