import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/response.ts";
import { generateInviteCode } from "../_shared/invite.ts";

type CreateMeetingRequest = {
  meetingName?: string;
  description?: string;
  meetingDatetime?: string;
  hostName?: string;
};

type MeetingRow = {
  meeting_id: number;
  meeting_name: string;
  invite_link: string;
  status: string;
  meeting_datetime: string | null;
  expired_at: string;
};

const MAX_INVITE_LINK_RETRIES = 5;
const UNIQUE_VIOLATION_CODE = "23505";

function formatKst(isoString: string | null) {
  if (!isoString) {
    return null;
  }

  return new Date(isoString).toLocaleString("sv-SE", {
    timeZone: "Asia/Seoul",
    hour12: false,
  }).replace(" ", "T") + "+09:00";
}

function getExpiredAt(createdAt: Date, meetingDatetime: string | null) {
  const defaultExpiredAt = new Date(createdAt);
  defaultExpiredAt.setDate(defaultExpiredAt.getDate() + 7);

  if (!meetingDatetime) {
    return defaultExpiredAt;
  }

  const meetingAt = new Date(meetingDatetime);

  return meetingAt > defaultExpiredAt ? meetingAt : defaultExpiredAt;
}

function parseMeetingDatetime(value?: string) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const datetime = hasTimezone
    ? new Date(trimmed)
    : new Date(`${trimmed.replace(" ", "T")}+09:00`);

  if (Number.isNaN(datetime.getTime())) {
    return undefined;
  }

  return datetime.toISOString();
}

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase environment variables.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "\uc9c0\uc6d0\ud558\uc9c0 \uc54a\ub294 \uc694\uccad \ubc29\uc2dd\uc785\ub2c8\ub2e4.");
  }

  let body: CreateMeetingRequest;

  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "\uc694\uccad \ubcf8\ubb38\uc774 \uc62c\ubc14\ub978 JSON \ud615\uc2dd\uc774 \uc544\ub2d9\ub2c8\ub2e4.");
  }

  const meetingName = body.meetingName?.trim();
  const hostName = body.hostName?.trim();
  const description = body.description?.trim() || null;
  const meetingDatetime = parseMeetingDatetime(body.meetingDatetime);

  if (!meetingName) {
    return errorResponse(400, "REQUIRED_FIELD_MISSING", "meetingName\uc740 \ud544\uc218\uc785\ub2c8\ub2e4.");
  }

  if (!hostName) {
    return errorResponse(400, "REQUIRED_FIELD_MISSING", "hostName\uc740 \ud544\uc218\uc785\ub2c8\ub2e4.");
  }

  if (meetingDatetime === undefined) {
    return errorResponse(400, "INVALID_DATETIME", "meetingDatetime\uc774 \uc62c\ubc14\ub978 \ub0a0\uc9dc/\uc2dc\uac04 \ud615\uc2dd\uc774 \uc544\ub2d9\ub2c8\ub2e4.");
  }

  const now = new Date();
  const expiredAt = getExpiredAt(now, meetingDatetime);

  let meeting: MeetingRow | null = null;
  let meetingError = null;

  for (let attempt = 0; attempt < MAX_INVITE_LINK_RETRIES; attempt += 1) {
    const inviteLink = generateInviteCode();
    const { data, error } = await supabase
      .from("meeting")
      .insert({
        meeting_name: meetingName,
        description,
        invite_link: inviteLink,
        meeting_datetime: meetingDatetime,
        expired_at: expiredAt.toISOString(),
        status: "OPEN",
        created_at: now.toISOString(),
      })
      .select("meeting_id, meeting_name, invite_link, status, meeting_datetime, expired_at")
      .single();

    meeting = data;
    meetingError = error;

    if (!error || error.code !== UNIQUE_VIOLATION_CODE) {
      break;
    }
  }

  if (meetingError || !meeting) {
    return errorResponse(500, "MEETING_CREATE_FAILED", "\ubaa8\uc784 \uc0dd\uc131\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.");
  }

  const { data: host, error: hostError } = await supabase
    .from("participant")
    .insert({
      meeting_id: meeting.meeting_id,
      participant_name: hostName,
      role: "HOST",
      input_location_yn: false,
      input_preference_yn: false,
      vote_yn: false,
      joined_at: now.toISOString(),
    })
    .select("participant_id, participant_name, role")
    .single();

  if (hostError || !host) {
    await supabase.from("meeting").delete().eq("meeting_id", meeting.meeting_id);
    return errorResponse(500, "HOST_CREATE_FAILED", "\uc8fc\ucd5c\uc790 \uc815\ubcf4 \uc800\uc7a5\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.");
  }

  return jsonResponse(
    {
      meetingId: meeting.meeting_id,
      meetingName: meeting.meeting_name,
      inviteLink: meeting.invite_link,
      status: meeting.status,
      meetingDatetime: meeting.meeting_datetime,
      meetingDatetimeKst: formatKst(meeting.meeting_datetime),
      expiredAt: meeting.expired_at,
      expiredAtKst: formatKst(meeting.expired_at),
      host: {
        participantId: host.participant_id,
        participantName: host.participant_name,
        role: host.role,
      },
    },
    201,
  );
});
