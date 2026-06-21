import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { apiFetch } from "@/lib/api/client";

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

/** 탭(마스터 종류)별 조회 에러 메시지 — 부분 강등용(Story 2.6/AC4). */
export type MasterLoadErrors = Partial<Record<keyof MastersData, string>>;
/** fetchMasters 결과 — 정상 테이블 data + 실패 테이블 errors(부분 강등). */
export type MastersLoad = { data: MastersData; errors: MasterLoadErrors };

/**
 * 마스터 데이터를 Supabase 직접 조회로 구성(전역 참조 데이터 — RLS authenticated SELECT, 0006).
 * active+inactive 전부 반환(관리화면이 비활성도 표시; 소비처 피커는 is_active=true 로 필터).
 *
 * **부분 강등(Story 2.6/AC4):** Supabase 쿼리는 reject 가 아니라 `{data,error}` 를 돌려주므로 5개를
 * Promise.all 로 모은 뒤 **첫 에러로 전체를 throw 하지 않고** 테이블별 에러를 errors 에 담는다. 한 테이블
 * 실패가 관리화면 전체를 다운시키던 단일 실패점을 제거 — 정상 테이블은 표시, 실패 탭만 에러로 강등한다.
 */
export async function fetchMasters(supabase: SupabaseClient): Promise<MastersLoad> {
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
  const errors: MasterLoadErrors = {};
  if (deptRes.error) errors.departments = deptRes.error.message;
  if (roomRes.error) errors.rooms = roomRes.error.message;
  if (dxRes.error) errors.diagnoses = dxRes.error.message;
  if (feeRes.error) errors.feeSchedules = feeRes.error.message;
  if (drugRes.error) errors.drugs = drugRes.error.message;
  return {
    data: {
      departments: (deptRes.data ?? []) as Department[],
      rooms: (roomRes.data ?? []) as Room[],
      diagnoses: (dxRes.data ?? []) as Diagnosis[],
      feeSchedules: (feeRes.data ?? []) as FeeSchedule[],
      drugs: (drugRes.data ?? []) as Drug[],
    },
    errors,
  };
}

/**
 * 진료과 전체(active+inactive, code 순) 직접조회 — 직원 진료과 배정 피커·소속 라벨용(Story 2.6).
 * active+inactive 전부 반환: 비활성 소속 직원의 라벨에 "(비활성)" 표기를 위해 라벨용엔 전체가 필요하고,
 * 신규 배정 피커는 호출부가 is_active 로 필터한다(room-form 패턴 동형). fail-loud(에러 throw).
 */
export async function fetchDepartments(supabase: SupabaseClient): Promise<Department[]> {
  const { data, error } = await supabase
    .from("departments")
    .select("id, code, name, description, is_active, created_at, updated_at")
    .order("code");
  if (error) {
    throw new Error(`진료과 조회 실패: ${error.message}`);
  }
  return (data ?? []) as Department[];
}

// ── 진료과 의존성 카운트(Story 2.4 / AC4) — 비활성 경고용 ─────────────────────────────────────
// 직원 수는 users RLS(본인행)를 넘어야 해서 FastAPI(service_role)로 읽는다(나머지 마스터 목록은 직접조회).
// 경고용 보조 정보 — 비활성 자체를 막지 않는다(soft delete 는 참조 중에도 가능, 과거 기록 보존).

/** FastAPI DepartmentDependents 의 거울. rooms=활성 진료실, staff=재직 직원. */
export type DepartmentDependents = { rooms: number; staff: number };

/** 진료과 비활성 전 의존성 카운트 조회(master.manage). 실패 시 ApiError throw(호출부가 fail-soft 처리). */
export function fetchDepartmentDependents(
  departmentId: string,
): Promise<DepartmentDependents> {
  return apiFetch<DepartmentDependents>(`/v1/masters/departments/${departmentId}/dependents`);
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

// ── 재사용 검색 피커(Story 2.3) — 마스터 검색·선택 강제(free-text 차단, FR-202) ─────────────
// 진단(KCD)·약품·수가 3종을 단일 피커가 소비(Epic 4.7·5.2·5.5/7.x). 읽기 = Supabase 직접조회.
// "현재 유효" 판정은 isCurrentlyValid 단일 술어 + 서버 today(DB 권위)로 통일(2.2 이월 해소).

/** 피커가 다루는 마스터 종류. 테이블·표시 컬럼을 결정. */
export type MasterKind = "diagnosis" | "drug" | "fee_schedule";

/**
 * 피커 선택 결과 — 소비처(Epic 4/5)가 필요로 하는 식별 필드 상위집합.
 * 행 필드는 snake_case 유지(전 경로 일관, project-context). 종류별 옵셔널은 해당 종류에만 채워짐.
 */
export type MasterPickerItem = {
  id: string;
  code: string;
  name: string;
  kind: MasterKind;
  // 유효기간 필드 — 자기기술적(소비처·피커가 동일 술어 isCurrentlyValid 로 방어 필터 가능).
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  ingredient_code?: string | null; // drug
  unit?: string | null; // drug
  category?: string | null; // fee_schedule
  amount_krw?: number; // fee_schedule (KRW 정수)
};

const MASTER_TABLE: Record<MasterKind, "diagnoses" | "drugs" | "fee_schedules"> = {
  diagnosis: "diagnoses",
  drug: "drugs",
  fee_schedule: "fee_schedules",
};

const MASTER_COLUMNS: Record<MasterKind, string> = {
  diagnosis: "id, code, name, effective_from, effective_to, is_active",
  drug: "id, code, name, ingredient_code, unit, effective_from, effective_to, is_active",
  fee_schedule: "id, code, name, category, amount_krw, effective_from, effective_to, is_active",
};

/** 조회 행(snake_case) → MasterPickerItem. 종류별 추가 필드만 채운다. */
export function toMasterPickerItem(kind: MasterKind, row: Record<string, unknown>): MasterPickerItem {
  const base: MasterPickerItem = {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    kind,
    is_active: Boolean(row.is_active),
    effective_from: String(row.effective_from),
    effective_to: (row.effective_to as string | null) ?? null,
  };
  if (kind === "fee_schedule") {
    return { ...base, category: (row.category as string | null) ?? null, amount_krw: Number(row.amount_krw) };
  }
  if (kind === "drug") {
    return {
      ...base,
      ingredient_code: (row.ingredient_code as string | null) ?? null,
      unit: (row.unit as string | null) ?? null,
    };
  }
  return base;
}

/**
 * "현재 유효" 코드만 Supabase 직접조회(DB 권위 — 서버 주입 today 로 SQL 필터).
 * is_active=true AND effective_from<=today AND (effective_to IS NULL OR effective_to>=today).
 * isCurrentlyValid 술어의 SQL 등가(소비처는 동일 today 를 컴포넌트 방어 필터에도 재사용해 드리프트 제거).
 * fail-loud: 에러는 throw(빈 배열 강등 금지).
 */
export async function fetchCurrentlyValidMasters(
  supabase: SupabaseClient,
  kind: MasterKind,
  today: string,
): Promise<MasterPickerItem[]> {
  const { data, error } = await supabase
    .from(MASTER_TABLE[kind])
    .select(MASTER_COLUMNS[kind])
    .eq("is_active", true)
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
    .order("code");
  if (error) {
    throw new Error(`코드 마스터 조회 실패: ${error.message}`);
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) =>
    toMasterPickerItem(kind, row),
  );
}

/** 피커 표시·검색 라벨("코드 · 명칭"). itemToStringLabel 로 입력창에 노출. */
export function masterItemLabel(item: MasterPickerItem): string {
  return `${item.code} · ${item.name}`;
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

/**
 * 진료과 id → 표시명(진료실 목록의 소속 컬럼). 미지정 → "—".
 * 비활성 소속은 "(비활성)" 마커(폼 select 와 일관, AC5). 미매칭 폴백은 중립적 "(미상)"
 * — hard delete 부재(soft delete만 + FK)로 정상 경로 비도달, "삭제된 진료과"는 오해 소지(절단/RLS 아티팩트뿐).
 */
export function departmentLabel(
  departments: Department[],
  departmentId: string | null,
): string {
  if (!departmentId) return "—";
  const dept = departments.find((d) => d.id === departmentId);
  if (!dept) return "(미상)";
  return dept.is_active ? dept.name : `${dept.name} (비활성)`;
}
