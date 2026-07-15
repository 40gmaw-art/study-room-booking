#!/usr/bin/env node
// One-off local script: reset the admin Supabase Auth user's password
// directly via the Admin API, without a password-recovery email.
//
// Run locally only: `npm run reset-admin-password`
// Never import this file from application code, and never expose the
// secret/service_role key to the browser.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", ".env.local");

function loadEnvLocal(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function fail(message) {
  console.error(`[reset-admin-password] 실패: ${message}`);
  process.exit(1);
}

function maskEmail(email) {
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return "(이메일 확인 불가)";
  }
  const [local, domain] = email.split("@");
  const maskedLocal =
    local.length <= 2 ? `${local[0] ?? "*"}*` : `${local.slice(0, 2)}${"*".repeat(local.length - 2)}`;
  return `${maskedLocal}@${domain}`;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_PASSWORD_LENGTH = 8;

async function main() {
  loadEnvLocal(envPath);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminUserId = process.env.ADMIN_USER_ID;
  const newPassword = process.env.ADMIN_NEW_PASSWORD;

  if (!supabaseUrl) {
    fail("NEXT_PUBLIC_SUPABASE_URL 환경변수가 없습니다.");
  }
  if (!secretKey) {
    fail("SUPABASE_SECRET_KEY 또는 SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  }
  if (!adminUserId) {
    fail("ADMIN_USER_ID 환경변수가 없습니다.");
  }
  if (!newPassword) {
    fail("ADMIN_NEW_PASSWORD 환경변수가 없습니다.");
  }
  if (!UUID_REGEX.test(adminUserId)) {
    fail("ADMIN_USER_ID 형식이 올바른 UUID가 아닙니다.");
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    fail(`ADMIN_NEW_PASSWORD는 최소 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(adminUserId, {
    password: newPassword,
  });

  if (error) {
    const notFound = error.status === 404 || /not found/i.test(error.message ?? "");
    fail(notFound ? "해당 ADMIN_USER_ID로 사용자를 찾을 수 없습니다." : `Supabase 관리자 요청 실패: ${error.message}`);
    return;
  }

  if (!data?.user) {
    fail("사용자를 찾지 못했습니다.");
    return;
  }

  console.log("[reset-admin-password] 비밀번호 변경 성공");
  console.log(`[reset-admin-password] 대상 계정: ${maskEmail(data.user.email)}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.");
});
