import { corsHeaders } from "./cors.ts";

export type ErrorCode =
  | "METHOD_NOT_ALLOWED"
  | "INVALID_JSON"
  | "INVALID_DATETIME"
  | "REQUIRED_FIELD_MISSING"
  | "MEETING_CREATE_FAILED"
  | "HOST_CREATE_FAILED";

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
