# LifeSync 백그라운드 알림 설정

정적 웹 페이지의 15초 타이머는 브라우저가 완전히 종료되면 실행되지 않습니다. 이 폴더의 서비스 워커와 Supabase Edge Function을 함께 배포해야 예약된 웹 푸시가 전송됩니다.

## 1. 테이블 만들기

Supabase SQL Editor에서 `supabase/push-setup.sql`을 실행합니다.

## 2. VAPID 키와 함수 비밀값 설정

```sh
npx web-push generate-vapid-keys
supabase secrets set VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." VAPID_SUBJECT="mailto:관리자이메일" REMINDER_CRON_SECRET="충분히긴임의문자열"
```

## 3. 함수 배포

```sh
supabase functions deploy reminder-push --no-verify-jwt
```

함수 내부에서 사용자 JWT를 직접 검증하며, 예약 발송 요청은 `x-cron-secret` 값도 확인합니다.

## 4. 매분 예약 발송 호출

Supabase Cron 또는 외부 스케줄러에서 매분 아래 주소로 POST 요청을 보냅니다.

```text
POST https://<project-ref>.supabase.co/functions/v1/reminder-push
x-cron-secret: <REMINDER_CRON_SECRET>
content-type: application/json

{"action":"deliver"}
```

사이트는 로그인 및 알림 허용 후 앞으로 32일의 일정·할 일·습관 알림을 서버에 자동 반영합니다. 브라우저가 완전히 종료된 상태의 푸시 전달 여부와 소리는 운영체제 및 브라우저 알림 설정의 영향을 받습니다.
