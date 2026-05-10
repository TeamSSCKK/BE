# 모임 생성 API

## 1. API 개요

모임을 생성하고, 생성된 모임에 주최자를 자동 등록하는 API입니다.

```http
POST /functions/v1/meetings
```

운영 URL:

```text
https://cplajjmgovwudktljqgs.supabase.co/functions/v1/meetings
```

## 2. 요청

```json
{
  "meetingName": "백엔드 테스트 모임",
  "description": "Edge Function 연결 확인",
  "meetingDatetime": "2026-05-20T10:00:00",
  "hostName": "최성욱"
}
```

## 3. 요청 필드

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `meetingName` | O | 모임 이름 |
| `description` | X | 모임 설명 |
| `meetingDatetime` | X | 모임 예정 일시 |
| `hostName` | O | 주최자 이름 |

## 4. 시간 정책

- `meetingDatetime`에 시간대 정보가 없으면 한국 시간(KST)으로 해석합니다.
- 예: `2026-05-20T10:00:00`은 한국 시간 2026-05-20 10:00입니다.
- DB에는 UTC 기준으로 저장합니다.
- 예: 한국 시간 2026-05-20 10:00은 DB에 `2026-05-20 01:00:00+00`로 저장될 수 있습니다.
- `created_at`, `joined_at`, `expired_at`도 UTC 기준으로 저장합니다.
- `expired_at`은 생성 시점 기준 7일 뒤와 모임 예정 시각 중 더 늦은 값입니다.
- 응답에는 화면 표시용으로 `meetingDatetimeKst`, `expiredAtKst`를 함께 내려줍니다.

## 5. 저장 구조

### meeting

| 컬럼 | 저장 값 |
| --- | --- |
| `meeting_name` | 요청의 `meetingName` |
| `description` | 요청의 `description`, 없으면 `null` |
| `invite_link` | 서버에서 생성한 10자리 초대 링크 식별값 |
| `meeting_datetime` | 한국 시간으로 해석한 뒤 UTC 기준으로 저장한 모임 예정 일시 |
| `expired_at` | 생성 시점 기준 7일 뒤와 모임 예정 시각 중 더 늦은 값 |
| `status` | `OPEN` |
| `created_at` | 생성 시점 |

`meeting_id`는 PostgreSQL identity 컬럼이므로 DB가 자동 생성합니다.

### participant

| 컬럼 | 저장 값 |
| --- | --- |
| `meeting_id` | 생성된 모임의 `meeting_id` |
| `participant_name` | 요청의 `hostName` |
| `role` | `HOST` |
| `input_location_yn` | `false` |
| `input_preference_yn` | `false` |
| `vote_yn` | `false` |
| `joined_at` | 생성 시점 |

주최자 저장에 실패하면, 주최자 없는 모임 데이터가 남지 않도록 직전에 생성한 `meeting` row를 삭제합니다.

## 6. 초대 링크 중복 처리

`invite_link` 컬럼에는 UNIQUE 제약이 있습니다.

서버에서 생성한 초대 링크 식별값이 이미 존재하면 최대 5번까지 새 식별값을 생성해 다시 저장을 시도합니다. 그래도 실패하면 `MEETING_CREATE_FAILED`를 반환합니다.

## 7. 성공 응답

```json
{
  "meetingId": 1,
  "meetingName": "백엔드 테스트 모임",
  "inviteLink": "aB12Cd34Ef",
  "status": "OPEN",
  "meetingDatetime": "2026-05-20T01:00:00+00:00",
  "meetingDatetimeKst": "2026-05-20T10:00:00+09:00",
  "expiredAt": "2026-05-20T01:00:00+00:00",
  "expiredAtKst": "2026-05-20T10:00:00+09:00",
  "host": {
    "participantId": 1,
    "participantName": "최성욱",
    "role": "HOST"
  }
}
```

## 8. 오류 응답

### 필수 입력값 누락

HTTP status: `400`

```json
{
  "code": "REQUIRED_FIELD_MISSING",
  "message": "meetingName은 필수입니다."
}
```

### 잘못된 JSON

HTTP status: `400`

```json
{
  "code": "INVALID_JSON",
  "message": "요청 본문이 올바른 JSON 형식이 아닙니다."
}
```

### 잘못된 모임 일시

HTTP status: `400`

```json
{
  "code": "INVALID_DATETIME",
  "message": "meetingDatetime이 올바른 날짜/시간 형식이 아닙니다."
}
```

### 지원하지 않는 요청 방식

HTTP status: `405`

```json
{
  "code": "METHOD_NOT_ALLOWED",
  "message": "지원하지 않는 요청 방식입니다."
}
```
