"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestStudentOtp, verifyStudentOtp } from "@/lib/auth-actions";

const OTP_LENGTH = 8;

const initialRequestState = { success: false as boolean, message: "", email: "" };
const initialVerifyState = { success: false as boolean, message: "" };

function emptyOtp() {
  return Array<string>(OTP_LENGTH).fill("");
}

export function StudentLoginForm() {
  const [step, setStep] = useState<"details" | "otp">("details");
  const [form, setForm] = useState({ name: "", department: "", studentNumber: "", email: "" });
  const [otpDigits, setOtpDigits] = useState<string[]>(emptyOtp);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [requestState, requestAction, isRequesting] = useActionState(requestStudentOtp, initialRequestState);
  const [verifyState, verifyAction, isVerifying] = useActionState(verifyStudentOtp, initialVerifyState);

  const otp = otpDigits.join("");

  useEffect(() => {
    if (requestState.success) {
      setStep("otp");
      setOtpDigits(emptyOtp());
      requestAnimationFrame(() => otpRefs.current[0]?.focus());
    }
  }, [requestState]);

  function handleOtpChange(index: number, rawValue: string) {
    const cleaned = rawValue.replace(/[^A-Za-z0-9]/g, "");
    const char = cleaned.slice(-1);
    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = char;
      return next;
    });
    if (char && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      if (!otpDigits[index] && index > 0) {
        event.preventDefault();
        setOtpDigits((prev) => {
          const next = [...prev];
          next[index - 1] = "";
          return next;
        });
        otpRefs.current[index - 1]?.focus();
      }
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      otpRefs.current[index - 1]?.focus();
      return;
    }

    if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      event.preventDefault();
      otpRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").replace(/[^A-Za-z0-9]/g, "").slice(0, OTP_LENGTH);
    if (!pasted) {
      return;
    }
    event.preventDefault();
    setOtpDigits(Array.from({ length: OTP_LENGTH }, (_, i) => pasted[i] ?? ""));
    const focusIndex = Math.max(Math.min(pasted.length, OTP_LENGTH) - 1, 0);
    requestAnimationFrame(() => otpRefs.current[focusIndex]?.focus());
  }

  return (
    <div className="space-y-4">
      {step === "details" ? (
        <form action={requestAction} className="space-y-4">
          <input type="hidden" name="intent" value="send" />
          <div className="grid gap-2">
            <Label htmlFor="name">이름</Label>
            <Input
              id="name"
              name="name"
              placeholder="김공명"
              required
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="department">학과</Label>
            <Input
              id="department"
              name="department"
              placeholder="경영학과"
              required
              value={form.department}
              onChange={(event) => setForm((prev) => ({ ...prev, department: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="studentNumber">학번</Label>
            <Input
              id="studentNumber"
              name="studentNumber"
              placeholder="202600000"
              required
              value={form.studentNumber}
              onChange={(event) => setForm((prev) => ({ ...prev, studentNumber: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">가천대학교 이메일</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="student@gachon.ac.kr"
              required
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </div>

          {!requestState.success && requestState.message ? (
            <p className="text-sm text-red-600">{requestState.message}</p>
          ) : null}

          <Button className="h-12 w-full rounded-full bg-[#4B3B71] hover:bg-[#3f315d]" type="submit" disabled={isRequesting}>
            {isRequesting ? "전송 중..." : "인증번호 받기"}
          </Button>

          <div className="space-y-1 pt-1 text-xs text-slate-500">
            <p>인증번호 받기를 누르면 가천대학교 이메일로 8자리 인증번호가 전송됩니다.</p>
            <p>메일에서 인증번호를 확인한 뒤 아래 입력란에 입력해주세요.</p>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="rounded-2xl bg-[#f8f4ff] p-3 text-sm text-slate-700">
            <strong className="text-[#4B3B71]">{requestState.email}</strong>로 인증번호를 전송했습니다.
          </p>
          <p className="text-xs text-slate-400">메일이 보이지 않는 경우 스팸메일함도 확인해 주세요.</p>

          <form action={verifyAction} className="space-y-4">
            <input type="hidden" name="email" value={requestState.email} />
            <input type="hidden" name="token" value={otp} />
            <div className="grid gap-2">
              <Label htmlFor="otp-0">인증번호</Label>
              <div className="flex gap-1 sm:gap-2">
                {otpDigits.map((digit, index) => (
                  <Input
                    key={index}
                    id={`otp-${index}`}
                    ref={(element) => {
                      otpRefs.current[index] = element;
                    }}
                    inputMode="text"
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    aria-label={`인증번호 ${index + 1}번째 자리`}
                    maxLength={1}
                    required={index === 0}
                    value={digit}
                    onChange={(event) => handleOtpChange(index, event.target.value)}
                    onKeyDown={(event) => handleOtpKeyDown(index, event)}
                    onPaste={handleOtpPaste}
                    onFocus={(event) => event.target.select()}
                    className="h-11 min-w-0 flex-1 rounded-xl px-0 text-center text-base font-semibold sm:h-12 sm:text-lg"
                  />
                ))}
              </div>
            </div>

            {!verifyState.success && verifyState.message ? (
              <p className="text-sm text-red-600">{verifyState.message}</p>
            ) : null}

            <Button
              className="h-12 w-full rounded-full bg-[#4B3B71] hover:bg-[#3f315d]"
              type="submit"
              disabled={isVerifying || otp.length !== OTP_LENGTH}
            >
              {isVerifying ? "확인 중..." : "인증번호 확인"}
            </Button>
          </form>

          <div className="flex flex-col gap-2 sm:flex-row">
            <form action={requestAction} className="sm:flex-1">
              <input type="hidden" name="name" value={form.name} />
              <input type="hidden" name="department" value={form.department} />
              <input type="hidden" name="studentNumber" value={form.studentNumber} />
              <input type="hidden" name="email" value={form.email} />
              <input type="hidden" name="intent" value="resend" />
              <Button
                type="submit"
                variant="outline"
                className="h-11 w-full rounded-full"
                disabled={isRequesting}
              >
                인증번호 다시 받기
              </Button>
            </form>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full rounded-full sm:w-auto"
              onClick={() => setStep("details")}
            >
              이메일 수정
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
