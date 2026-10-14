# 가천대학교 제40대 경영대학 공명 스터디룸 예약

이 프로젝트는 가천대학교 경영대학 학생이 공명 스터디룸을 예약하고 관리할 수 있도록 구성된 Next.js + Supabase 앱입니다.

## 예약 정책

- 운영일은 월요일부터 금요일까지입니다.
- 토요일과 일요일은 예약할 수 없습니다.
- 한국 시간 기준으로 오늘부터 다음 주 금요일까지 예약 가능합니다.
- 이미 시작된 시간대나 지난 시간대는 예약할 수 없습니다.

## 실행 방법

1. 의존성 설치
   ```bash
   npm install
   ```
2. 로컬 환경 변수 설정
   ```bash
   cp .env.example .env.local
   ```
3. 개발 서버 실행
   ```bash
   npm run dev
   ```

## 학생 이메일 인증 설정

학생 로그인은 Supabase Auth의 이메일 OTP를 사용합니다. `requestStudentOtp`가
`signInWithOtp`를 호출하고, 서버의 `verifyStudentOtp`가 6자리 번호를 검증합니다.
새 인증 계정 생성은 허용되며 프로필은 인증 완료 후 저장됩니다.

- Supabase Dashboard의 **Authentication → Providers → Email**에서 이메일 제공자와
  신규 사용자 가입이 활성화되어 있는지 확인합니다.
- **Authentication → Email Templates**의 OTP 템플릿에 `{{ .Token }}`이 포함되어
  있어야 합니다. 이 앱은 이메일 링크가 아닌 6자리 코드를 검증합니다.
- Supabase 기본 메일 발송은 테스트/저용량 제한이 있으므로 모든 학생에게 보내려면
  **Authentication → SMTP Settings**에 실제 발송용 SMTP 제공자를 설정하고,
  제공자 측 발신자 도메인 인증 및 수신자 제한을 확인합니다.
- **Authentication → Rate Limits**에서 이메일 OTP 한도를 확인합니다. 제한 초과는
  서버 로그에 Supabase의 상태 및 오류 코드와 함께 기록됩니다.

앱이 사용하는 환경변수는 `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ADMIN_SESSION_SECRET`,
`ADMIN_USERNAME`, `ADMIN_AUTH_EMAIL`입니다. 같은 이름의 값을 Vercel의
**Project Settings → Environment Variables**에서 해당하는 Production 환경에 설정한 뒤
재배포해야 합니다. Supabase의 SMTP 자격 증명은 앱 환경변수가 아니라 Supabase
Dashboard의 SMTP 설정에 보관하며 소스 코드나 Vercel 클라이언트 변수에 넣지 않습니다.

## 주요 기능

- 학생 로그인 및 예약
- 예약 취소 및 내 예약 확인
- 관리자 예약 관리
- Supabase 기반 인증 및 데이터 저장
