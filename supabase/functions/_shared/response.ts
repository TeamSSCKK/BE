import { corsHeaders } from "./cors.ts";

export type ErrorCode =
  | "METHOD_NOT_ALLOWED"
  | "INVALID_JSON"
  | "INVALID_DATETIME"
  | "REQUIRED_FIELD_MISSING"
  | "MEETING_CREATE_FAILED"
  | "HOST_CREATE_FAILED"
  | "MEETING_NOT_FOUND"
  | "INVALID_URL"
  | "INVITE_NOT_FOUND"
  | "MEETING_CLOSED"
  | "INVITE_EXPIRED"
  | "PARTICIPANT_ALREADY_EXISTS"
  | "PARTICIPANT_CREATE_FAILED"
  | "PARTICIPANT_NOT_FOUND"
  | "LOCATION_CREATE_FAILED"
  | "PREFERENCE_CREATE_FAILED"
  | "LOCATION_NOT_FOUND"
  | "PREFERENCE_REQUIRED"
  | "INTERNAL_SERVER_ERROR";

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function errorResponse(status: number, code: ErrorCode, message: string) {
  return jsonResponse({ code, message }, status);
}
