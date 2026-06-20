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

/** FastAPI DiagnosisResponse 의 거울(snake_case). 날짜는 YYYY-MM-DD 문자열. */
export type Diagnosis = {
  id: string;
  code: string;
  name: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** FastAPI FeeScheduleResponse 의 거울. amount_krw=KRW 정수. */
export type FeeSchedule = {
  id: string;
  code: string;
  name: string;
  amount_krw: number;
  category: string | null;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** FastAPI DrugResponse 의 거울. */
export type Drug = {
  id: string;
  code: string;
  name: string;
  ingredient_code: string | null;
  unit: string | null;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type MastersData = {
  departments: Department[];
  rooms: Room[];
  diagnoses: Diagnosis[];
  feeSchedules: FeeSchedule[];
  drugs: Drug[];
};

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
  const [deptRes, roomRes, dxRes, feeRes, drugRes] = await Promise.all([
    supabase
      .from("departments")
      .select("id, code, name, description, is_active, created_at, updated_at")
      .order("code"),
    supabase
      .from("rooms")
      .select("id, code, name, department_id, is_active, created_at, updated_at")
      .order("code"),
    supabase
      .from("diagnoses")
      .select("id, code, name, effective_from, effective_to, is_active, created_at, updated_at")
      .order("code"),
    supabase
      .from("fee_schedules")
      .select("id, code, name, amount_krw, category, effective_from, effective_to, is_active, created_at, updated_at")
      .order("code"),
    supabase
      .from("drugs")
      .select("id, code, name, ingredient_code, unit, effective_from, effective_to, is_active, created_at, updated_at")
      .order("code"),
  ]);
  const firstError =
    deptRes.error ?? roomRes.error ?? dxRes.error ?? feeRes.error ?? drugRes.error;
  if (firstError) {
    throw new Error(`마스터 조회 실패: ${firstError.message}`);
  }
  return {
    departments: (deptRes.data ?? []) as Department[],
    rooms: (roomRes.data ?? []) as Room[],
    diagnoses: (dxRes.data ?? []) as Diagnosis[],
    feeSchedules: (feeRes.data ?? []) as FeeSchedule[],
    drugs: (drugRes.data ?? []) as Drug[],
  };
}

// ── 코드 마스터 유효기간 상태(Story 2.2) — code-unique + effective-dating 모델 ────────────────
// "버전"은 effective_from/effective_to 유효기간 + audit_logs 변경이력으로 표현(별도 version 컬럼 없음).
// 날짜는 YYYY-MM-DD 문자열 비교(사전식 = 날짜순). today 는 로컬(KST) 기준.

/** 로컬(브라우저=KST) 오늘 날짜 YYYY-MM-DD. 테스트는 now 를 주입해 결정적으로 검증. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type EffectiveRow = { is_active: boolean; effective_from: string; effective_to: string | null };

export type CodeStatus = "valid" | "pending" | "expired" | "inactive";

/** 코드 마스터의 시점 상태(관리화면 배지용). 비활성 > 발효전 > 만료 > 유효 순으로 판정. */
export function codeStatus(row: EffectiveRow, today: string = todayISO()): CodeStatus {
  if (!row.is_active) return "inactive";
  if (row.effective_from > today) return "pending";
  if (row.effective_to !== null && row.effective_to < today) return "expired";
  return "valid";
}

/**
 * "현재 유효" 필터(AC2 단일 정의) — 소비처(2.3 피커·Epic4·5)가 신규 선택 노출에 사용.
 * is_active=true AND 발효일 ≤ 오늘 AND (만료일 없음 OR 만료일 ≥ 오늘). 경계 포함.
 */
export function isCurrentlyValid(row: EffectiveRow, today: string = todayISO()): boolean {
  return (
    row.is_active &&
    row.effective_from <= today &&
    (row.effective_to === null || row.effective_to >= today)
  );
}

/** 시점 상태 메타(라벨 + 배지 색). 색+글리프+라벨 3중 인코딩(음영 단독 의존 금지, UX-DR20). */
export const CODE_STATUS_META: Record<CodeStatus, { label: string; badgeClass: string }> = {
  valid: { label: "유효", badgeClass: "border-status-done/40 bg-status-done/12 text-status-done-ink" },
  pending: {
    label: "발효 전",
    badgeClass: "border-status-scheduled/40 bg-status-scheduled/12 text-status-scheduled",
  },
  expired: {
    label: "만료",
    badgeClass: "border-status-received/40 bg-status-received/12 text-status-received-ink",
  },
  inactive: {
    label: "비활성",
    badgeClass: "border-status-cancelled/40 bg-status-cancelled/12 text-status-cancelled",
  },
};

/** 금액 KRW 천단위 표기(tabular-nums 와 함께 사용). */
export function formatKrw(amount: number): string {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

// ── 코드 마스터 검증(Zod) — Pydantic 스키마의 거울. code 는 생성 시에만(불변) ───────────────

export const diagnosisCreateSchema = z
  .object({
    code: z.string().trim().min(1, "코드를 입력하세요").max(20),
    name: z.string().trim().min(1, "이름을 입력하세요").max(200),
    effective_from: z.string().min(1, "발효일을 선택하세요"),
    effective_to: z.string(), // "" = 무기한
  })
  .refine((v) => !v.effective_to || v.effective_to >= v.effective_from, {
    message: "만료일은 발효일 이후여야 합니다",
    path: ["effective_to"],
  });
export type DiagnosisCreateValues = z.infer<typeof diagnosisCreateSchema>;

export const feeScheduleCreateSchema = z
  .object({
    code: z.string().trim().min(1, "코드를 입력하세요").max(20),
    name: z.string().trim().min(1, "이름을 입력하세요").max(200),
    amount_krw: z
      .string()
      .trim()
      .min(1, "금액을 입력하세요")
      .regex(/^\d+$/, "0 이상의 정수만 입력하세요")
      // PG integer 상한(2,147,483,647). 초과 시 서버 422·DB 오버플로 방지(2^53 초과 Number() 손실도 차단).
      .refine((s) => Number(s) <= 2_147_483_647, "금액이 너무 큽니다(최대 2,147,483,647원)"),
    category: z.string().trim().max(100),
    effective_from: z.string().min(1, "발효일을 선택하세요"),
    effective_to: z.string(),
  })
  .refine((v) => !v.effective_to || v.effective_to >= v.effective_from, {
    message: "만료일은 발효일 이후여야 합니다",
    path: ["effective_to"],
  });
export type FeeScheduleCreateValues = z.infer<typeof feeScheduleCreateSchema>;

export const drugCreateSchema = z
  .object({
    code: z.string().trim().min(1, "코드를 입력하세요").max(20),
    name: z.string().trim().min(1, "이름을 입력하세요").max(200),
    ingredient_code: z.string().trim().max(20),
    unit: z.string().trim().max(20),
    effective_from: z.string().min(1, "발효일을 선택하세요"),
    effective_to: z.string(),
  })
  .refine((v) => !v.effective_to || v.effective_to >= v.effective_from, {
    message: "만료일은 발효일 이후여야 합니다",
    path: ["effective_to"],
  });
export type DrugCreateValues = z.infer<typeof drugCreateSchema>;

// payload 매퍼 — create 는 빈 옵셔널 제거, update 는 code 제외 + 옵셔널/만료를 항상 전송(부분수정 NULL 방지).

export function toDiagnosisCreatePayload(v: DiagnosisCreateValues): Record<string, unknown> {
  const p: Record<string, unknown> = { code: v.code, name: v.name, effective_from: v.effective_from };
  if (v.effective_to) p.effective_to = v.effective_to;
  return p;
}

export function toDiagnosisUpdatePayload(v: DiagnosisCreateValues): Record<string, unknown> {
  return { name: v.name, effective_from: v.effective_from, effective_to: v.effective_to || null };
}

export function toFeeScheduleCreatePayload(v: FeeScheduleCreateValues): Record<string, unknown> {
  const p: Record<string, unknown> = {
    code: v.code,
    name: v.name,
    amount_krw: Number(v.amount_krw),
    effective_from: v.effective_from,
  };
  if (v.category) p.category = v.category;
  if (v.effective_to) p.effective_to = v.effective_to;
  return p;
}

export function toFeeScheduleUpdatePayload(v: FeeScheduleCreateValues): Record<string, unknown> {
  return {
    name: v.name,
    amount_krw: Number(v.amount_krw),
    category: v.category || null,
    effective_from: v.effective_from,
    effective_to: v.effective_to || null,
  };
}

export function toDrugCreatePayload(v: DrugCreateValues): Record<string, unknown> {
  const p: Record<string, unknown> = { code: v.code, name: v.name, effective_from: v.effective_from };
  if (v.ingredient_code) p.ingredient_code = v.ingredient_code;
  if (v.unit) p.unit = v.unit;
  if (v.effective_to) p.effective_to = v.effective_to;
  return p;
}

export function toDrugUpdatePayload(v: DrugCreateValues): Record<string, unknown> {
  return {
    name: v.name,
    ingredient_code: v.ingredient_code || null,
    unit: v.unit || null,
    effective_from: v.effective_from,
    effective_to: v.effective_to || null,
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
