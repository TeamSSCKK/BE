import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/response.ts";
import { getKstIsoString } from "../_shared/datetime.ts";

serve(async (req) => {
  // 1. CORS Preflight (OPTIONS 요청 처리)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 2. URL 경로 파싱
    const url = new URL(req.url);
    const pathRegex = /\/invites\/([^\/]+)(?:\/(participants))?$/;
    const match = url.pathname.match(pathRegex);

    if (!match) {
      return errorResponse(404, "INVALID_URL", "잘못된 API 경로입니다.");
    }

    const inviteLink = match[1];
    const isParticipantAction = match[2] === "participants";

    // 3. 공통 검증: 초대 링크로 모임 찾기
    const { data: meeting, error: meetingError } = await supabase
      .from("Meeting")
      .select("*")
      .eq("invite_link", inviteLink)
      .single();

    if (meetingError || !meeting) {
      return errorResponse(404, "INVITE_NOT_FOUND", "유효하지 않은 초대 링크입니다.");
    }

    if (meeting.status !== "OPEN") {
      return errorResponse(409, "MEETING_CLOSED", "이미 닫힌 모임입니다.");
    }

    const now = new Date();
    const expiredAt = new Date(meeting.expired_at);
    if (now > expiredAt) {
      return errorResponse(410, "INVITE_EXPIRED", "만료된 초대 링크입니다.");
    }

    // ====================================================================
    // [GET] /invites/{inviteLink} - 초대 링크로 모임 정보 조회
    // ====================================================================
    if (req.method === "GET" && !isParticipantAction) {
      return jsonResponse({
        meetingId: meeting.meeting_id,
        meetingName: meeting.meeting_name,
        description: meeting.description,
        meetingDatetime: meeting.meeting_datetime,
        meetingDatetimeKst: getKstIsoString(meeting.meeting_datetime),
        status: meeting.status,
        expiredAt: meeting.expired_at,
        expiredAtKst: getKstIsoString(meeting.expired_at),
      }, 200);
    }

    // ====================================================================
    // [POST] /invites/{inviteLink}/participants - 참여자 등록
    // ====================================================================
    if (req.method === "POST" && isParticipantAction) {
      let body;
      try {
        body = await req.json();
      } catch (e) {
        return errorResponse(400, "INVALID_JSON", "잘못된 JSON 형식입니다.");
      }

      const { participantName } = body;
      
      if (!participantName || participantName.trim() === "") {
        return errorResponse(400, "REQUIRED_FIELD_MISSING", "participantName은 필수 입력값입니다.");
      }

      // 참여자 DB Insert
      const { data: participant, error: insertError } = await supabase
        .from("Participant")
        .insert({
          meeting_id: meeting.meeting_id,
          participant_name: participantName,
          role: "GUEST", 
          input_location_yn: false,
          input_preference_yn: false,
          vote_yn: false,
        })
        .select()
        .single();

      if (insertError) {
        // PostgreSQL 중복 에러 코드
        if (insertError.code === "23505") {
          return errorResponse(409, "PARTICIPANT_ALREADY_EXISTS", "이미 참여한 이름입니다.");
        }
        console.error("Participant Insert Error:", insertError);
        return errorResponse(500, "PARTICIPANT_CREATE_FAILED", "참여자 등록 중 오류가 발생했습니다.");
      }

      return jsonResponse({
        meetingId: meeting.meeting_id,
        participant: {
          participantId: participant.participant_id,
          participantName: participant.participant_name,
          role: participant.role,
        },
      }, 201); // 201 Created
    }

    // 예외: GET, POST 이외의 잘못된 메서드 호출 시
    return errorResponse(405, "METHOD_NOT_ALLOWED", "허용되지 않은 HTTP 메서드입니다.");

  } catch (error) {
    console.error("Unexpected Error:", error);
    return errorResponse(500, "INTERNAL_SERVER_ERROR", "서버 내부 오류가 발생했습니다.");
  }
});