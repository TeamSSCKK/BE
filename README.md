# SSCKK Backend

Supabase Edge Functions 기반 백엔드 프로젝트입니다.

## 현재 구현 범위

- 모임 생성 API
- 모임 생성 시 주최자 참가자 자동 등록
- 초대 링크 식별값 생성
- 필수 입력값 및 모임 일시 형식 검증
- 초대 링크 중복 발생 시 재시도
- 주최자 저장 실패 시 생성된 모임 정리
- 초대 링크가 최소 모임 예정 시각까지 유효하도록 만료 시각 설정

## 프로젝트 구조

```text
supabase/
  config.toml
  functions/
    meetings/
      index.ts
    _shared/
      cors.ts
      invite.ts
      response.ts
docs/
  meeting-api.md
```

## Supabase 프로젝트

```text
project_ref: cplajjmgovwudktljqgs
function: meetings
endpoint: https://cplajjmgovwudktljqgs.supabase.co/functions/v1/meetings
```

## 환경변수

Supabase Edge Function 실행 환경에는 아래 값이 필요합니다.

```env
SUPABASE_URL=https://cplajjmgovwudktljqgs.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service-role-key
```

`SUPABASE_SERVICE_ROLE_KEY`는 서버 전용 비밀키입니다. 프론트엔드 코드나 공개 저장소에 올리면 안 됩니다.

`supabase/.temp/`는 Supabase CLI가 로컬 프로젝트 연결 정보를 저장하는 임시 폴더입니다. Git에 올리지 않도록 `.gitignore`에 포함되어 있습니다.

## 배포

```bash
npx supabase functions deploy meetings --project-ref cplajjmgovwudktljqgs
```

## 테스트

Supabase 대시보드의 Edge Function 테스트 화면 또는 API 클라이언트에서 아래 주소로 `POST` 요청을 보냅니다.

```text
https://cplajjmgovwudktljqgs.supabase.co/functions/v1/meetings
```

요청 예시:

```json
{
  "meetingName": "백엔드 테스트 모임",
  "description": "Edge Function 연결 확인",
  "meetingDatetime": "2026-05-20T10:00:00",
  "hostName": "최성욱"
}
```

확인할 내용:

- 응답에 `meetingId`와 `inviteLink`가 포함됩니다.
- `host.participantName`이 `최성욱`입니다.
- `meetingDatetimeKst`가 `2026-05-20T10:00:00+09:00`입니다.
- `expiredAtKst`는 생성 시점 기준 7일 뒤와 모임 예정 시각 중 더 늦은 값입니다.
- `meeting` 테이블과 `participant` 테이블에 각각 row가 생성됩니다.
