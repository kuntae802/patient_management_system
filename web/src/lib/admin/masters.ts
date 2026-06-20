import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// 진료과·진료실 마스터(Story 2.1) 공용 타입·상수·검증·직접조회.
// ⚠️ 전 경로 snake_case 유지(camelCase 변환 금지, project-context). 읽기 = Supabase 직접조회(전역 참조
//    데이터, 0006 RLS authenticated SELECT). 쓰기 = FastAPI(apiFetch, master.manage).

/** FastAPI DepartmentResponse 의 거울(snake_case). */
export type Department = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** FastAPI RoomResponse 의 거울(snake_case). */
export type Room = {
  id: string;
  code: string;
  name: string;
  department_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type MastersData = { departments: Department[]; rooms: Room[] };

/** 활성/비활성 표시 메타(라벨 + 배지 색). 색+글리프+라벨로 인코딩(음영 단독 의존 금지, UX-DR20). */
export const ACTIVE_STATUS_META = {
  active: {
    label: "활성",
    badgeClass: "border-status-done/40 bg-status-done/12 text-status-done-ink",
  },
  inactive: {
    label: "비활성",
    badgeClass: "border-status-cancelled/40 bg-status-cancelled/12 text-status-cancelled",
  },
} as const;

export function activeMeta(isActive: boolean): { label: string; badgeClass: string } {
  return isActive ? ACTIVE_STATUS_META.active : ACTIVE_STATUS_META.inactive;
}

/**
 * 마스터 데이터를 Supabase 직접 조회로 구성(전역 참조 데이터 — RLS authenticated SELECT, 0006).
 * active+inactive 전부 반환(관리화면이 비활성도 표시; 소비처 피커는 is_active=true 로 필터).
 * fail-loud: 에러를 []로 강등하면 '데이터 없음'으로 오인되므로 RSC 에러로 throw.
 */
export async function fetchMasters(supabase: SupabaseClient): Promise<MastersData> {
  const [deptRes, roomRes] = await Promise.all([
    supabase
      .from("departments")
      .select("id, code, name, description, is_active, created_at, updated_at")
      .order("code"),
    supabase
      .from("rooms")
      .select("id, code, name, department_id, is_active, created_at, updated_at")
      .order("code"),
  ]);
  const firstError = deptRes.error ?? roomRes.error;
  if (firstError) {
    throw new Error(`마스터 조회 실패: ${firstError.message}`);
  }
  return {
    departments: (deptRes.data ?? []) as Department[],
    rooms: (roomRes.data ?? []) as Room[],
  };
}

// ── 검증(Zod) — Pydantic 스키마의 거울(3중 검증의 클라 1선) ─────────────────────
// code 는 생성 시에만(불변). 옵셔널은 "" 허용 후 제출 시 정규화.

export const departmentCreateSchema = z.object({
  code: z.string().trim().min(1, "코드를 입력하세요").max(50),
  name: z.string().trim().min(1, "이름을 입력하세요").max(100),
  description: z.string().trim().max(500),
});
export type DepartmentCreateValues = z.infer<typeof departmentCreateSchema>;

export const roomCreateSchema = z.object({
  code: z.string().trim().min(1, "코드를 입력하세요").max(50),
  name: z.string().trim().min(1, "이름을 입력하세요").max(100),
  department_id: z.string(), // "" = 미지정
});
export type RoomCreateValues = z.infer<typeof roomCreateSchema>;

/** 진료과 생성 페이로드. 빈 description 은 제거(서버 None 계약). */
export function toDepartmentCreatePayload(v: DepartmentCreateValues): Record<string, unknown> {
  const payload: Record<string, unknown> = { code: v.code, name: v.name };
  if (v.description) payload.description = v.description;
  return payload;
}

/** 진료과 수정 페이로드(code 불변 — 미포함). description 은 항상 전송(빈값=해제)해 부분수정 누락 방지. */
export function toDepartmentUpdatePayload(v: DepartmentCreateValues): Record<string, unknown> {
  return { name: v.name, description: v.description ? v.description : null };
}

/** 진료실 생성 페이로드. 빈 department_id 는 제거(무소속). */
export function toRoomCreatePayload(v: RoomCreateValues): Record<string, unknown> {
  const payload: Record<string, unknown> = { code: v.code, name: v.name };
  if (v.department_id) payload.department_id = v.department_id;
  return payload;
}

/** 진료실 수정 페이로드(code 불변). department_id 는 항상 전송(빈값=소속 해제)해 부분수정 누락 방지. */
export function toRoomUpdatePayload(v: RoomCreateValues): Record<string, unknown> {
  return { name: v.name, department_id: v.department_id ? v.department_id : null };
}

/** 진료과 id → 표시명(진료실 목록의 소속 컬럼). 미지정/미존재 → 폴백. */
export function departmentLabel(
  departments: Department[],
  departmentId: string | null,
): string {
  if (!departmentId) return "—";
  return departments.find((d) => d.id === departmentId)?.name ?? "(삭제된 진료과)";
}
