"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAdmin } from "@/lib/auth-actions";

const initialState = { success: false as boolean, message: "" };

export function AdminLoginForm() {
  const [state, formAction, isPending] = useActionState(signInAdmin, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="username">관리자 아이디</Label>
        <Input id="username" name="username" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">비밀번호</Label>
        <Input id="password" name="password" type="password" required />
      </div>
      {!state.success && state.message ? (
        <p className="rounded-2xl bg-slate-50 p-3 text-sm text-red-600">{state.message}</p>
      ) : null}
      <Button className="h-12 w-full rounded-full bg-[#4B3B71] hover:bg-[#3f315d]" type="submit" disabled={isPending}>
        {isPending ? "확인 중..." : "로그인"}
      </Button>
    </form>
  );
}
