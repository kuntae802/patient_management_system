import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { apiFetch } from "@/lib/api/client";
import { type Department, type Room } from "@/lib/admin/masters";

// 근무표·휴진(Story 6.1) 공용 타입·검증·직접조회·payload 매퍼.
// ⚠️ 전 경로 snake_case 유지(camelCase 변환 금지, project-context). 읽기 = Supabase 직접조회(전역 참조
//    데이터, 0030 RLS authenticated SELECT) — 단 의사 목록은 users RLS(본인행)라 FastAPI(apiFetch).
//    쓰기 = FastAPI(apiFetch, master.manage). 겹침은 서버 409 schedule_overlap.

/** FastAPI DoctorScheduleResponse 의 거울(snake_case). 시각은 "HH:MM:SS" 문자열. */
export type DoctorSchedule = {
  id: string;
  doctor_id: string;
  department_id: string;
  room_id: string | null;
  weekday: number; // 0=일 .. 6=토 (PG dow)
  start_time: string;
  end_time: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** FastAPI DoctorTimeOffResponse 의 거울. start_at/end_at = ISO timestamptz 문자열. */
export type DoctorTimeOff = {
  id: string;
  doctor_id: string;
  start_at: string;
  end_at: string;
  reason: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** FastAPI SchedulingDoctor 의 거울 — 근무표 폼 의사 피커용. */
export type SchedulingDoctor = {
  id: string;
  name: string;
  department_id: string | null;
};

export type SchedulingData = {
  schedules: DoctorSchedule[];
  timeOffs: DoctorTimeOff[];
  departments: Department[];
  rooms: Room[];
};

/** 탭(자원 종류)별 조회 에러 — 부분 강등용(masters 2.6/AC4 동형). */
export type SchedulingLoadErrors = Partial<Record<keyof SchedulingData, string>>;
export type SchedulingLoad = { data: SchedulingData; errors: SchedulingLoadErrors };

/**
 * 근무표·휴진·진료과·진료실을 Supabase 직접조회로 구성(전역 참조 — RLS authenticated SELECT, 0030/0006).
 * active+inactive 전부 반환(관리화면이 비활성도 표시). **부분 강등(masters fetchMasters 패턴):** 한
 * 자원 실패가 화면 전체를 다운시키지 않게 자원별 에러를 errors 에 담는다(첫 에러 throw 금지).
 * ⚠️ 의사명은 여기서 조인하지 않는다 — users RLS(본인행, 0003)가 타 의사 행을 가려 직접조회로는 못
 * 읽으므로, 매니저가 fetchSchedulingDoctors(FastAPI) 로 따로 받아 클라에서 이름을 해석한다.
 */
export async function fetchSchedules(supabase: SupabaseClient): Promise<SchedulingLoad> {
  const [schedRes, timeOffRes, deptRes, roomRes] = await Promise.all([
    supabase
      .from("doctor_schedules")
      .select("id, doctor_id, department_id, room_id, weekday, start_time, end_time, is_active, created_at, updated_at")
      .order("weekday")
      .order("start_time"),
    supabase
      .from("doctor_time_offs")
      .select("id, doctor_id, start_at, end_at, reason, is_active, created_at, updated_at")
      .order("start_at"),
    supabase
      .from("departments")
      .select("id, code, name, description, is_active, created_at, updated_at")
      .order("code"),
    supabase
      .from("rooms")
      .select("id, code, name, department_id, is_active, created_at, updated_at")
      .order("code"),
  ]);
  const errors: SchedulingLoadErrors = {};
  if (schedRes.error) errors.schedules = schedRes.error.message;
  if (timeOffRes.error) errors.timeOffs = timeOffRes.error.message;
  if (deptRes.error) errors.departments = deptRes.error.message;
  if (roomRes.error) errors.rooms = roomRes.error.message;
  return {
    data: {
      schedules: (schedRes.data ?? []) as DoctorSchedule[],
      timeOffs: (timeOffRes.data ?? []) as DoctorTimeOff[],
      departments: (deptRes.data ?? []) as Department[],
      rooms: (roomRes.data ?? []) as Room[],
    },
    errors,
  };
}

/** 재직 의사 목록(근무표 폼 피커·이름 해석용). users RLS(본인행) → FastAPI service_role read. */
export function fetchSchedulingDoctors(): Promise<SchedulingDoctor[]> {
  return apiFetch<SchedulingDoctor[]>("/v1/scheduling/doctors");
}

// ── 표시 헬퍼 ─────────────────────────────────────────────────────────────────

/** 요일 라벨(인덱스=weekday, 0=일 .. 6=토 — PG dow 정합). */
export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? "?";
}

/** "09:00:00"·"09:00" → "09:00". 시각 입력/표시 정규화(초 절단). */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

/** 근무 시간대 표시("09:00–12:30"). */
export function formatTimeRange(start: string, end: string): string {
  return `${hhmm(start)}–${hhmm(end)}`;
}

/** 의사 id → 표시명. 미매칭(목록 미로딩·RLS) → "(미상)"(masters departmentLabel 동형). */
export function doctorLabel(doctors: SchedulingDoctor[], doctorId: string): string {
  return doctors.find((d) => d.id === doctorId)?.name ?? "(미상)";
}

/** 진료실 id → 표시명. 미지정 → "—", 미매칭 → "(미상)". */
export function roomLabel(rooms: Room[], roomId: string | null): string {
  if (!roomId) return "—";
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return "(미상)";
  return room.is_active ? room.name : `${room.name} (비활성)`;
}

/** ISO timestamptz → KST 사람용 표기("2026-07-01 09:00"). 휴진 기간 표시용. */
export function formatKstDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** ISO timestamptz → datetime-local 입력값("YYYY-MM-DDTHH:MM", KST 벽시계). 휴진 폼 편집 동기화용. */
export function isoToLocalInput(iso: string): string {
  const kstMs = new Date(iso).getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 16);
}

/** datetime-local("YYYY-MM-DDTHH:MM") → KST 오프셋 부착 ISO("...:00+09:00"). 서버 timestamptz 정확 저장. */
export function localInputToKstIso(local: string): string {
  const withSec = local.length === 16 ? `${local}:00` : local;
  return `${withSec}+09:00`;
}

// ── 검증(Zod) — Pydantic 스키마의 거울(3중 검증의 클라 1선) ─────────────────────

export const doctorScheduleCreateSchema = z
  .object({
    doctor_id: z.string().min(1, "의사를 선택하세요"),
    department_id: z.string().min(1, "진료과를 선택하세요"),
    room_id: z.string(), // "" = 미지정
    weekday: z.string().regex(/^[0-6]$/, "요일을 선택하세요"),
    start_time: z.string().min(1, "시작 시각을 입력하세요"),
    end_time: z.string().min(1, "종료 시각을 입력하세요"),
  })
  .refine((v) => v.end_time > v.start_time, {
    message: "종료 시각은 시작 시각보다 뒤여야 합니다",
    path: ["end_time"],
  });
export type DoctorScheduleCreateValues = z.infer<typeof doctorScheduleCreateSchema>;

export const doctorTimeOffCreateSchema = z
  .object({
    doctor_id: z.string().min(1, "의사를 선택하세요"),
    start_at: z.string().min(1, "시작 일시를 입력하세요"),
    end_at: z.string().min(1, "종료 일시를 입력하세요"),
    reason: z.string().trim().max(200),
  })
  .refine((v) => v.end_at > v.start_at, {
    message: "종료 일시는 시작 일시보다 뒤여야 합니다",
    path: ["end_at"],
  });
export type DoctorTimeOffCreateValues = z.infer<typeof doctorTimeOffCreateSchema>;

// payload 매퍼 — 근무표엔 불변 code 가 없어 create·update 모두 전 필드. room_id 는 create=빈값 제거,
// update=항상 전송(빈값=해제, 부분수정 NULL 방지, masters room 패턴). weekday 는 select 문자열 → 정수.

export function toScheduleCreatePayload(v: DoctorScheduleCreateValues): Record<string, unknown> {
  const p: Record<string, unknown> = {
    doctor_id: v.doctor_id,
    department_id: v.department_id,
    weekday: Number(v.weekday),
    start_time: v.start_time,
    end_time: v.end_time,
  };
  if (v.room_id) p.room_id = v.room_id;
  return p;
}

export function toScheduleUpdatePayload(v: DoctorScheduleCreateValues): Record<string, unknown> {
  return {
    doctor_id: v.doctor_id,
    department_id: v.department_id,
    room_id: v.room_id ? v.room_id : null,
    weekday: Number(v.weekday),
    start_time: v.start_time,
    end_time: v.end_time,
  };
}

export function toTimeOffCreatePayload(v: DoctorTimeOffCreateValues): Record<string, unknown> {
  const p: Record<string, unknown> = {
    doctor_id: v.doctor_id,
    start_at: localInputToKstIso(v.start_at),
    end_at: localInputToKstIso(v.end_at),
  };
  if (v.reason) p.reason = v.reason;
  return p;
}

export function toTimeOffUpdatePayload(v: DoctorTimeOffCreateValues): Record<string, unknown> {
  return {
    start_at: localInputToKstIso(v.start_at),
    end_at: localInputToKstIso(v.end_at),
    reason: v.reason ? v.reason : null,
  };
}
