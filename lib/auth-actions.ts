"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isGachonEmail } from "@/lib/booking";
import { clearAdminSession, createAdminSession } from "@/lib/admin-session";

const studentProfileSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력해 주세요."),
  department: z.string().trim().min(1, "학과를 입력해 주세요."),
  studentNumber: z.string().trim().min(1, "학번을 입력해 주세요."),
  email: z.string().trim().toLowerCase().email("올바른 이메일 형식이 아닙니다.").refine(isGachonEmail, {
    message: "@gachon.ac.kr 이메일만 사용할 수 있습니다.",
  }),
});

const otpVerifySchema = z.object({
  email: z.string().trim().toLowerCase().email("올바른 이메일 형식이 아닙니다.").refine(isGachonEmail, {
    message: "@gachon.ac.kr 이메일만 사용할 수 있습니다.",
  }),
  token: z.string().trim().regex(/^\d{6}$/, "인증번호 6자리를 입력해 주세요."),
});

const adminLoginSchema = z.object({
  username: z.string().trim().min(1, "관리자 아이디를 입력해 주세요."),
  password: z.string().min(1, "비밀번호를 입력해 주세요."),
});

async function getProfileForCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, name, department, student_number, role")
    .eq("id", user.id)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function requestStudentOtp(prevState: unknown, formData: FormData) {
  const parsed = studentProfileSchema.safeParse({
    name: formData.get("name"),
    department: formData.get("department"),
    studentNumber: formData.get("studentNumber"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return {
      success: false as const,
      message: parsed.error.issues[0]?.message ?? "입력 내용을 확인해 주세요.",
      email: String(formData.get("email") ?? ""),
    };
  }

  const payload = parsed.data;
  const isResend = formData.get("intent") === "resend";
  const supabase = await createClient();
  const cookieStore = await cookies();

  // A student login attempt must never carry over a leftover admin-mode
  // session from an earlier /admin/login, even before this attempt succeeds.
  await clearAdminSession();

  cookieStore.set(
    "study-room-profile",
    JSON.stringify({
      name: payload.name,
      department: payload.department,
      studentNumber: payload.studentNumber,
      email: payload.email,
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    },
  );

  const { error } = await supabase.auth.signInWithOtp({
    email: payload.email,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    const rateLimited = error.status === 429 || /rate limit/i.test(error.message ?? "");
    return {
      success: false as const,
      message: rateLimited
        ? "잠시 후 다시 시도해주세요."
        : "인증번호 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      email: payload.email,
    };
  }

  return {
    success: true as const,
    message: isResend
      ? "인증번호를 다시 전송했습니다."
      : "인증번호를 전송했습니다. 가천대학교 이메일을 확인해주세요.",
    email: payload.email,
  };
}

export async function verifyStudentOtp(prevState: unknown, formData: FormData) {
  const parsed = otpVerifySchema.safeParse({
    email: formData.get("email"),
    token: formData.get("token"),
  });

  if (!parsed.success) {
    return {
      success: false as const,
      message: parsed.error.issues[0]?.message ?? "인증번호를 다시 확인해 주세요.",
    };
  }

  const { email, token } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error || !data.user) {
    const rateLimited = error?.status === 429 || /rate limit/i.test(error?.message ?? "");
    return {
      success: false as const,
      message: rateLimited
        ? "인증 시도가 너무 많습니다. 잠시 후 다시 시도해주세요."
        : "인증번호가 올바르지 않거나 만료되었습니다.",
    };
  }

  const authedEmail = data.user.email?.trim().toLowerCase() ?? "";
  if (authedEmail !== email || !isGachonEmail(authedEmail)) {
    await supabase.auth.signOut();
    return {
      success: false as const,
      message: "이메일 인증 정보가 일치하지 않습니다.",
    };
  }

  const cookieStore = await cookies();
  const pending = cookieStore.get("study-room-profile")?.value;

  if (!pending) {
    return {
      success: false as const,
      message: "입력 정보가 만료되었습니다. 처음부터 다시 시도해 주세요.",
    };
  }

  let profilePayload: { name?: string; department?: string; studentNumber?: string; email?: string };
  try {
    profilePayload = JSON.parse(pending);
  } catch {
    return {
      success: false as const,
      message: "입력 정보가 올바르지 않습니다. 처음부터 다시 시도해 주세요.",
    };
  }

  if ((profilePayload.email ?? "").trim().toLowerCase() !== authedEmail) {
    return {
      success: false as const,
      message: "이메일 인증 정보가 일치하지 않습니다.",
    };
  }

  if (!profilePayload.name || !profilePayload.department || !profilePayload.studentNumber) {
    return {
      success: false as const,
      message: "입력 정보가 올바르지 않습니다. 처음부터 다시 시도해 주세요.",
    };
  }

  // role is intentionally omitted: new rows default to 'student' via the column
  // default, and existing rows keep whatever role they already had.
  const { error: upsertError } = await supabase.from("profiles").upsert(
    {
      id: data.user.id,
      email: authedEmail,
      name: profilePayload.name,
      department: profilePayload.department,
      student_number: profilePayload.studentNumber,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (upsertError) {
    return {
      success: false as const,
      message: "프로필 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  cookieStore.delete("study-room-profile");
  // Guarantee a fresh student login never carries an admin-mode session,
  // even if the same account also happens to hold profiles.role === 'admin'.
  await clearAdminSession();
  // Bust the Next.js client router cache for every route (they all nest
  // under the one root layout). Without this, a route rendered under a
  // PREVIOUS session (e.g. the admin buttons on "/") can still be served
  // from the router cache for a while after this auth change, showing the
  // wrong role's UI intermittently until that cache entry naturally expires.
  revalidatePath("/", "layout");
  redirect("/booking");
}

export async function ensureProfileAfterLogin() {
  const cookieStore = await cookies();
  const pending = cookieStore.get("study-room-profile")?.value;

  if (!pending) {
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  const profilePayload = JSON.parse(pending);
  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: profilePayload.email,
      name: profilePayload.name,
      department: profilePayload.department,
      student_number: profilePayload.studentNumber,
      role: "student",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (!error) {
    cookieStore.delete("study-room-profile");
  }
}

export async function signOutUser() {
  const supabase = await createClient();
  const cookieStore = await cookies();

  cookieStore.delete("study-room-profile");
  await clearAdminSession();
  await supabase.auth.signOut();
  // Same reasoning as verifyStudentOtp: without this, a subsequent login
  // (as either role) could briefly see a route cache entry rendered while
  // this session was still active.
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signInAdmin(prevState: unknown, formData: FormData) {
  const parsed = adminLoginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      success: false as const,
      message: parsed.error.issues[0]?.message ?? "입력 내용을 확인해 주세요.",
    };
  }

  const envUsername = process.env.ADMIN_USERNAME?.trim();
  const envEmail = process.env.ADMIN_AUTH_EMAIL?.trim();

  if (!envUsername || !envEmail) {
    return {
      success: false as const,
      message: "관리자 환경변수가 설정되지 않았습니다.",
    };
  }

  if (parsed.data.username !== envUsername) {
    return {
      success: false as const,
      message: "관리자 아이디가 올바르지 않습니다.",
    };
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: envEmail,
    password: parsed.data.password,
  });

  if (authError || !authData.user) {
    return {
      success: false as const,
      message: "관리자 인증에 실패했습니다.",
    };
  }

  const profile = await getProfileForCurrentUser();
  if (!profile || profile.role !== "admin") {
    await clearAdminSession();
    await supabase.auth.signOut();
    return {
      success: false as const,
      message: "관리자 권한이 없는 계정입니다.",
    };
  }

  try {
    await createAdminSession(authData.user.id);
  } catch {
    await clearAdminSession();
    await supabase.auth.signOut();
    return {
      success: false as const,
      message: "관리자 로그인 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.",
    };
  }

  // Same reasoning as verifyStudentOtp/signOutUser: without this, "/" (and
  // any other route visited earlier in this browser) could still serve a
  // router-cache entry rendered under the previous role/session.
  revalidatePath("/", "layout");
  redirect("/admin");
}

export async function getCurrentUserProfile() {
  return getProfileForCurrentUser();
}
