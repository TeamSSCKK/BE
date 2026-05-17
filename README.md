# SSCKK Backend

Supabase Edge Functions 기반 백엔드 프로젝트입니다.

## 구현 범위

- 모임 생성 API
- 초대 링크로 모임 조회
- 초대 링크로 참가자 등록
- 참가자 위치 정보 저장
- 참가자 취향 정보 저장
- 참가자별/모임별 입력 현황 조회
- 참가자 위치 데이터 조회
- 참가자 취향 데이터 조회 및 취향 미입력 예외 응답
- 입력 완료 상태 계산

## 프로젝트 구조

```text
supabase/
  config.toml
  migrations/
    20260518030000_participant_input.sql
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

## 환경 변수

Supabase Edge Function 실행 환경에는 아래 값이 필요합니다.

```env
SUPABASE_URL=https://cplajjmgovwudktljqgs.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service-role-key
```

`SUPABASE_SERVICE_ROLE_KEY`는 서버 전용 비밀키입니다. 공개 저장소나 클라이언트 코드에 포함하면 안 됩니다.

## 주요 API

### 모임 생성

```http
POST /functions/v1/meetings
```

```json
{
  "meetingName": "백엔드 테스트 모임",
  "description": "Edge Function 연결 확인",
  "meetingDatetime": "2026-05-20T10:00:00",
  "hostName": "최성민"
}
```

`meetingDatetime`에 시간대 정보가 없으면 KST로 해석하고, DB에는 UTC 기준으로 저장합니다.

### 초대 링크 조회

```http
GET /functions/v1/meetings/invites/{inviteLink}
```

### 초대 링크로 참가자 등록

```http
POST /functions/v1/meetings/invites/{inviteLink}/participants
```

```json
{
  "participantName": "참가자"
}
```

### 참가자 위치 정보 저장

```http
POST /functions/v1/meetings/participants/{participantId}/location
```

```json
{
  "placeName": "회사",
  "address": "서울특별시 중구 세종대로 110",
  "latitude": 37.5665,
  "longitude": 126.978,
  "returnAddress": "서울역",
  "returnLatitude": 37.5547,
  "returnLongitude": 126.9706
}
```

`address`, `latitude`, `longitude`는 필수입니다. 저장에 성공하면 해당 참가자의 `input_location_yn`이 `true`로 변경됩니다.

### 참가자 취향 정보 저장

```http
POST /functions/v1/meetings/participants/{participantId}/preference
```

```json
{
  "food": "korean",
  "budget": "medium",
  "spicy": "yes"
}
```

요청 본문의 각 key/value가 `participant_preference.preference_type`, `participant_preference.preference_value`로 저장됩니다. 저장에 성공하면 해당 참가자의 `input_preference_yn`이 `true`로 변경됩니다.

### 참가자 입력 현황 조회

```http
GET /functions/v1/meetings/participants/{participantId}/input-status
GET /functions/v1/meetings/{meetingId}/participants/input-status
```

모임별 조회 응답에는 참가자 목록, 입력 개수, 전체 완료 여부, 위치/취향 미입력 참가자 목록이 포함됩니다.

### 참가자 위치 데이터 조회

```http
GET /functions/v1/meetings/{meetingId}/participants/locations
```

### 참가자 취향 데이터 조회

```http
GET /functions/v1/meetings/{meetingId}/participants/preferences
```

취향을 입력하지 않은 참가자가 있으면 `409 PREFERENCE_REQUIRED`를 반환하며, 응답에 미입력 참가자 목록과 입력 현황 요약이 포함됩니다.

## 배포

```bash
npx supabase db push --linked
npx supabase functions deploy meetings --project-ref cplajjmgovwudktljqgs
```

## 검증

```bash
deno check supabase/functions/meetings/index.ts
```

배포 후에는 실제 endpoint로 모임 생성, 참가자 등록, 위치/취향 저장, 입력 현황 조회를 순서대로 호출해 확인합니다.
