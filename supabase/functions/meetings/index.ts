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

type ParticipantInputRequest = Record<string, unknown>;

type MeetingRow = {
  meeting_id: number;
  meeting_name: string;
  description: string | null;
  invite_link: string;
  status: string;
  meeting_datetime: string | null;
  expired_at: string;
};

type ParticipantRow = {
  participant_id: number;
  meeting_id: number;
  participant_name: string;
  role: string;
  input_location_yn: boolean;
  input_preference_yn: boolean;
  vote_yn: boolean;
};

type ParticipantLocationRow = {
  participant_id: number;
  place_name: string | null;
  address: string;
  latitude: number;
  longitude: number;
  return_address: string | null;
  return_latitude: number | null;
  return_longitude: number | null;
};

type ParticipantPreferenceRow = {
  participant_id: number;
  preference_type: string;
  preference_value: string;
};

const MAX_INVITE_LINK_RETRIES = 5;
const UNIQUE_VIOLATION_CODE = "23505";
const MEETING_SELECT = "meeting_id, meeting_name, description, invite_link, status, meeting_datetime, expired_at";
const PARTICIPANT_SELECT = "participant_id, meeting_id, participant_name, role, input_location_yn, input_preference_yn, vote_yn";

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

function getPathParts(request: Request) {
  const pathname = new URL(request.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const functionIndex = parts.indexOf("meetings");

  return functionIndex >= 0 ? parts.slice(functionIndex + 1) : parts;
}

function parsePositiveId(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isObjectBody(body: unknown): body is ParticipantInputRequest {
  return !!body && typeof body === "object" && !Array.isArray(body);
}

function getStringValue(body: ParticipantInputRequest, key: string) {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNumberValue(body: ParticipantInputRequest, key: string) {
  const value = body[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return null;
}

function getPreferenceEntries(body: ParticipantInputRequest) {
  return Object.entries(body)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => ({
      preference_type: key,
      preference_value: typeof value === "string" ? value : JSON.stringify(value),
    }));
}

function toParticipantResponse(participant: ParticipantRow) {
  const inputLocation = !!participant.input_location_yn;
  const inputPreference = !!participant.input_preference_yn;

  return {
    participantId: participant.participant_id,
    meetingId: participant.meeting_id,
    participantName: participant.participant_name,
    role: participant.role,
    inputLocation,
    inputPreference,
    inputComplete: inputLocation && inputPreference,
    vote: !!participant.vote_yn,
  };
}

function toMeetingResponse(meeting: MeetingRow) {
  return {
    meetingId: meeting.meeting_id,
    meetingName: meeting.meeting_name,
    description: meeting.description,
    inviteLink: meeting.invite_link,
    status: meeting.status,
    meetingDatetime: meeting.meeting_datetime,
    meetingDatetimeKst: formatKst(meeting.meeting_datetime),
    expiredAt: meeting.expired_at,
    expiredAtKst: formatKst(meeting.expired_at),
  };
}

async function readJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase environment variables.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function findParticipant(participantId: number) {
  const { data, error } = await supabase
    .from("participant")
    .select(PARTICIPANT_SELECT)
    .eq("participant_id", participantId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as ParticipantRow;
}

async function findMeeting(meetingId: number) {
  const { data, error } = await supabase
    .from("meeting")
    .select(MEETING_SELECT)
    .eq("meeting_id", meetingId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as MeetingRow;
}

async function findOpenMeetingByInvite(inviteLink: string) {
  const { data: meeting, error } = await supabase
    .from("meeting")
    .select(MEETING_SELECT)
    .eq("invite_link", inviteLink)
    .single();

  if (error || !meeting) {
    return { response: errorResponse(404, "INVITE_NOT_FOUND", "유효하지 않은 초대 링크입니다."), meeting: null };
  }

  const meetingRow = meeting as MeetingRow;

  if (meetingRow.status !== "OPEN") {
    return { response: errorResponse(409, "MEETING_CLOSED", "이미 닫힌 모임입니다."), meeting: null };
  }

  if (new Date() > new Date(meetingRow.expired_at)) {
    return { response: errorResponse(410, "INVITE_EXPIRED", "만료된 초대 링크입니다."), meeting: null };
  }

  return { response: null, meeting: meetingRow };
}

async function createMeeting(request: Request) {
  if (request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "지원하지 않는 요청 방식입니다.");
  }

  const body = await readJsonBody(request) as CreateMeetingRequest | undefined;

  if (!body) {
    return errorResponse(400, "INVALID_JSON", "요청 본문이 올바른 JSON 형식이 아닙니다.");
  }

  const meetingName = body.meetingName?.trim();
  const hostName = body.hostName?.trim();
  const description = body.description?.trim() || null;
  const meetingDatetime = parseMeetingDatetime(body.meetingDatetime);

  if (!meetingName) {
    return errorResponse(400, "REQUIRED_FIELD_MISSING", "meetingName은 필수입니다.");
  }

  if (!hostName) {
    return errorResponse(400, "REQUIRED_FIELD_MISSING", "hostName은 필수입니다.");
  }

  if (meetingDatetime === undefined) {
    return errorResponse(400, "INVALID_DATETIME", "meetingDatetime이 올바른 날짜/시간 형식이 아닙니다.");
  }

  const now = new Date();
  const expiredAt = getExpiredAt(now, meetingDatetime);

  let meeting: MeetingRow | null = null;
  let meetingError: unknown = null;

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
      .select(MEETING_SELECT)
      .single();

    meeting = data as MeetingRow | null;
    meetingError = error;

    if (!error || error.code !== UNIQUE_VIOLATION_CODE) {
      break;
    }
  }

  if (meetingError || !meeting) {
    return errorResponse(500, "MEETING_CREATE_FAILED", "모임 생성에 실패했습니다.");
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
    .select(PARTICIPANT_SELECT)
    .single();

  if (hostError || !host) {
    await supabase.from("meeting").delete().eq("meeting_id", meeting.meeting_id);
    return errorResponse(500, "HOST_CREATE_FAILED", "주최자 정보 저장에 실패했습니다.");
  }

  return jsonResponse(
    {
      ...toMeetingResponse(meeting),
      host: toParticipantResponse(host as ParticipantRow),
    },
    201,
  );
}

async function getInvite(inviteLink: string) {
  const { response, meeting } = await findOpenMeetingByInvite(inviteLink);

  if (response) {
    return response;
  }

  if (!meeting) {
    return errorResponse(404, "INVITE_NOT_FOUND", "유효하지 않은 초대 링크입니다.");
  }

  return jsonResponse(toMeetingResponse(meeting));
}

async function createParticipant(inviteLink: string, request: Request) {
  const { response, meeting } = await findOpenMeetingByInvite(inviteLink);

  if (response) {
    return response;
  }

  if (!meeting) {
    return errorResponse(404, "INVITE_NOT_FOUND", "유효하지 않은 초대 링크입니다.");
  }

  const body = await readJsonBody(request);

  if (!isObjectBody(body)) {
    return errorResponse(400, "INVALID_JSON", "요청 본문이 올바른 JSON 형식이 아닙니다.");
  }

  const participantName = typeof body.participantName === "string" ? body.participantName.trim() : "";

  if (!participantName) {
    return errorResponse(400, "REQUIRED_FIELD_MISSING", "participantName은 필수입니다.");
  }

  const { data: participant, error } = await supabase
    .from("participant")
    .insert({
      meeting_id: meeting.meeting_id,
      participant_name: participantName,
      role: "GUEST",
      input_location_yn: false,
      input_preference_yn: false,
      vote_yn: false,
      joined_at: new Date().toISOString(),
    })
    .select(PARTICIPANT_SELECT)
    .single();

  if (error || !participant) {
    if (error?.code === UNIQUE_VIOLATION_CODE) {
      return errorResponse(409, "PARTICIPANT_ALREADY_EXISTS", "이미 참여한 이름입니다.");
    }

    return errorResponse(500, "PARTICIPANT_CREATE_FAILED", "참여자 등록에 실패했습니다.");
  }

  return jsonResponse(
    {
      meetingId: meeting.meeting_id,
      participant: toParticipantResponse(participant as ParticipantRow),
    },
    201,
  );
}

async function saveParticipantLocation(participantId: number, request: Request) {
  const participant = await findParticipant(participantId);

  if (!participant) {
    return errorResponse(404, "PARTICIPANT_NOT_FOUND", "참가자를 찾을 수 없습니다.");
  }

  const body = await readJsonBody(request);

  if (!isObjectBody(body)) {
    return errorResponse(400, "INVALID_JSON", "위치 정보가 올바른 JSON 형식이 아닙니다.");
  }

  const address = getStringValue(body, "address");
  const latitude = getNumberValue(body, "latitude");
  const longitude = getNumberValue(body, "longitude");

  if (!address || latitude === null || longitude === null) {
    return errorResponse(400, "REQUIRED_FIELD_MISSING", "address, latitude, longitude는 필수입니다.");
  }

  await supabase
    .from("participant_location")
    .delete()
    .eq("participant_id", participantId);

  const { data: location, error } = await supabase
    .from("participant_location")
    .insert({
      participant_id: participantId,
      place_name: getStringValue(body, "placeName") ?? getStringValue(body, "place_name"),
      address,
      latitude,
      longitude,
      return_address: getStringValue(body, "returnAddress") ?? getStringValue(body, "return_address"),
      return_latitude: getNumberValue(body, "returnLatitude") ?? getNumberValue(body, "return_latitude"),
      return_longitude: getNumberValue(body, "returnLongitude") ?? getNumberValue(body, "return_longitude"),
    })
    .select("participant_id, place_name, address, latitude, longitude, return_address, return_latitude, return_longitude")
    .single();

  if (error || !location) {
    return errorResponse(500, "LOCATION_CREATE_FAILED", "참가자 위치 정보 저장에 실패했습니다.");
  }

  const { data: updatedParticipant } = await supabase
    .from("participant")
    .update({ input_location_yn: true })
    .eq("participant_id", participantId)
    .select(PARTICIPANT_SELECT)
    .single();

  return jsonResponse({
    participant: toParticipantResponse((updatedParticipant as ParticipantRow | null) ?? { ...participant, input_location_yn: true }),
    location: {
      participantId: (location as ParticipantLocationRow).participant_id,
      placeName: (location as ParticipantLocationRow).place_name,
      address: (location as ParticipantLocationRow).address,
      latitude: (location as ParticipantLocationRow).latitude,
      longitude: (location as ParticipantLocationRow).longitude,
      returnAddress: (location as ParticipantLocationRow).return_address,
      returnLatitude: (location as ParticipantLocationRow).return_latitude,
      returnLongitude: (location as ParticipantLocationRow).return_longitude,
    },
  });
}

async function saveParticipantPreference(participantId: number, request: Request) {
  const participant = await findParticipant(participantId);

  if (!participant) {
    return errorResponse(404, "PARTICIPANT_NOT_FOUND", "참가자를 찾을 수 없습니다.");
  }

  const body = await readJsonBody(request);

  if (!isObjectBody(body)) {
    return errorResponse(400, "INVALID_JSON", "취향 정보가 올바른 JSON 형식이 아닙니다.");
  }

  const preferenceRows = getPreferenceEntries(body).map((preference) => ({
    participant_id: participantId,
    ...preference,
  }));

  if (preferenceRows.length === 0) {
    return errorResponse(400, "REQUIRED_FIELD_MISSING", "저장할 취향 정보가 필요합니다.");
  }

  await supabase
    .from("participant_preference")
    .delete()
    .eq("participant_id", participantId);

  const { data: preferences, error } = await supabase
    .from("participant_preference")
    .insert(preferenceRows)
    .select("participant_id, preference_type, preference_value");

  if (error || !preferences) {
    return errorResponse(500, "PREFERENCE_CREATE_FAILED", "참가자 취향 정보 저장에 실패했습니다.");
  }

  const { data: updatedParticipant } = await supabase
    .from("participant")
    .update({ input_preference_yn: true })
    .eq("participant_id", participantId)
    .select(PARTICIPANT_SELECT)
    .single();

  return jsonResponse({
    participant: toParticipantResponse((updatedParticipant as ParticipantRow | null) ?? { ...participant, input_preference_yn: true }),
    preferences: (preferences as ParticipantPreferenceRow[]).map((preference) => ({
      participantId: preference.participant_id,
      preferenceType: preference.preference_type,
      preferenceValue: preference.preference_value,
    })),
  });
}

async function getParticipantStatus(participantId: number) {
  const participant = await findParticipant(participantId);

  if (!participant) {
    return errorResponse(404, "PARTICIPANT_NOT_FOUND", "참가자를 찾을 수 없습니다.");
  }

  return jsonResponse({ participant: toParticipantResponse(participant) });
}

async function findMeetingParticipants(meetingId: number) {
  const meeting = await findMeeting(meetingId);

  if (!meeting) {
    return null;
  }

  const { data, error } = await supabase
    .from("participant")
    .select(PARTICIPANT_SELECT)
    .eq("meeting_id", meetingId)
    .order("participant_id", { ascending: true })
    .returns<ParticipantRow[]>();

  if (error || !data) {
    return null;
  }

  return data;
}

function buildInputStatus(participants: ParticipantRow[]) {
  const participantResponses = participants.map(toParticipantResponse);
  const missingLocationParticipants = participantResponses.filter((participant) => !participant.inputLocation);
  const missingPreferenceParticipants = participantResponses.filter((participant) => !participant.inputPreference);

  return {
    participants: participantResponses,
    summary: {
      participantCount: participants.length,
      locationInputCount: participantResponses.length - missingLocationParticipants.length,
      preferenceInputCount: participantResponses.length - missingPreferenceParticipants.length,
      allLocationInputComplete: participants.length > 0 && missingLocationParticipants.length === 0,
      allPreferenceInputComplete: participants.length > 0 && missingPreferenceParticipants.length === 0,
      allInputComplete: participants.length > 0
        && missingLocationParticipants.length === 0
        && missingPreferenceParticipants.length === 0,
    },
    missingLocationParticipants,
    missingPreferenceParticipants,
  };
}

async function getMeetingInputStatus(meetingId: number) {
  const participants = await findMeetingParticipants(meetingId);

  if (!participants) {
    return errorResponse(404, "MEETING_NOT_FOUND", "모임을 찾을 수 없습니다.");
  }

  return jsonResponse({
    meetingId,
    ...buildInputStatus(participants),
  });
}

async function getMeetingLocations(meetingId: number) {
  const participants = await findMeetingParticipants(meetingId);

  if (!participants) {
    return errorResponse(404, "MEETING_NOT_FOUND", "모임을 찾을 수 없습니다.");
  }

  const status = buildInputStatus(participants);
  const participantIds = participants.map((participant) => participant.participant_id);

  if (participantIds.length === 0) {
    return jsonResponse({ meetingId, locations: [], ...status });
  }

  const { data: locations, error } = await supabase
    .from("participant_location")
    .select("participant_id, place_name, address, latitude, longitude, return_address, return_latitude, return_longitude")
    .in("participant_id", participantIds)
    .returns<ParticipantLocationRow[]>();

  if (error || !locations) {
    return errorResponse(404, "LOCATION_NOT_FOUND", "참가자 위치 데이터를 찾을 수 없습니다.");
  }

  const participantMap = new Map(participants.map((participant) => [participant.participant_id, participant]));

  return jsonResponse({
    meetingId,
    locations: locations.map((location) => {
      const participant = participantMap.get(location.participant_id);

      return {
        participantId: location.participant_id,
        participantName: participant?.participant_name ?? null,
        placeName: location.place_name,
        address: location.address,
        latitude: location.latitude,
        longitude: location.longitude,
        returnAddress: location.return_address,
        returnLatitude: location.return_latitude,
        returnLongitude: location.return_longitude,
      };
    }),
    ...status,
  });
}

async function getMeetingPreferences(meetingId: number) {
  const participants = await findMeetingParticipants(meetingId);

  if (!participants) {
    return errorResponse(404, "MEETING_NOT_FOUND", "모임을 찾을 수 없습니다.");
  }

  const status = buildInputStatus(participants);

  if (status.missingPreferenceParticipants.length > 0) {
    return jsonResponse({
      code: "PREFERENCE_REQUIRED",
      message: "취향 정보를 입력하지 않은 참가자가 있습니다.",
      meetingId,
      missingPreferenceParticipants: status.missingPreferenceParticipants,
      summary: status.summary,
    }, 409);
  }

  const participantIds = participants.map((participant) => participant.participant_id);
  const { data: preferences, error } = await supabase
    .from("participant_preference")
    .select("participant_id, preference_type, preference_value")
    .in("participant_id", participantIds)
    .returns<ParticipantPreferenceRow[]>();

  if (error || !preferences) {
    return errorResponse(500, "PREFERENCE_CREATE_FAILED", "참가자 취향 정보 조회에 실패했습니다.");
  }

  const participantMap = new Map(participants.map((participant) => [participant.participant_id, participant]));

  return jsonResponse({
    meetingId,
    preferences: preferences.map((preference) => {
      const participant = participantMap.get(preference.participant_id);

      return {
        participantId: preference.participant_id,
        participantName: participant?.participant_name ?? null,
        preferenceType: preference.preference_type,
        preferenceValue: preference.preference_value,
      };
    }),
    ...status,
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const parts = getPathParts(request);

    if (parts.length === 0) {
      return await createMeeting(request);
    }

    if (parts[0] === "invites" && parts[1] && parts.length === 2 && request.method === "GET") {
      return await getInvite(parts[1]);
    }

    if (parts[0] === "invites" && parts[1] && parts[2] === "participants" && parts.length === 3 && request.method === "POST") {
      return await createParticipant(parts[1], request);
    }

    if (parts[0] === "participants" && parts.length === 3) {
      const participantId = parsePositiveId(parts[1]);

      if (!participantId) {
        return errorResponse(404, "PARTICIPANT_NOT_FOUND", "참가자를 찾을 수 없습니다.");
      }

      if (parts[2] === "location" && request.method === "POST") {
        return await saveParticipantLocation(participantId, request);
      }

      if (parts[2] === "preference" && request.method === "POST") {
        return await saveParticipantPreference(participantId, request);
      }

      if (parts[2] === "input-status" && request.method === "GET") {
        return await getParticipantStatus(participantId);
      }
    }

    if (parts.length === 3 && parts[1] === "participants") {
      const meetingId = parsePositiveId(parts[0]);

      if (!meetingId) {
        return errorResponse(404, "MEETING_NOT_FOUND", "모임을 찾을 수 없습니다.");
      }

      if (parts[2] === "input-status" && request.method === "GET") {
        return await getMeetingInputStatus(meetingId);
      }

      if (parts[2] === "locations" && request.method === "GET") {
        return await getMeetingLocations(meetingId);
      }

      if (parts[2] === "preferences" && request.method === "GET") {
        return await getMeetingPreferences(meetingId);
      }
    }

    return errorResponse(404, "INVALID_URL", "잘못된 API 경로입니다.");
  } catch (error) {
    console.error("Unexpected Error:", error);
    return errorResponse(500, "INTERNAL_SERVER_ERROR", "서버 내부 오류가 발생했습니다.");
  }
});
