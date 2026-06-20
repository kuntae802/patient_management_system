import { z } from "zod";

import { ROLE_LABELS } from "@/lib/nav/staff-nav";

// 직원 계정 관리(Story 1.8) 공용 타입·상수·검증. API 응답은 snake_case 유지(전 경로 일관, project-context).

export type EmploymentStatus = "active" | "on_leave" | "terminated";
export type LicenseType = "doctor" | "radiologist";

/** FastAPI StaffResponse 의 거울(snake_case). email/비밀번호는 응답에 없다. */
export type StaffMember = {
  id: string;
  employee_no: string;
  name: string;
  role_code: string;
  employment_status: EmploymentStatus;
  license_no: string | null;
  license_type: LicenseType | null;
  phone: string | null;
  hire_date: string | null;
  department_id: string | null;
  created_at: string;
  updated_at: string;
};

/** 재직상태 표시 메타(라벨 + 배지 색). 색+글리프+라벨로 인코딩(음영 단독 의존 금지, UX-DR20). */
export const EMPLOYMENT_STATUS_META: Record<
  EmploymentStatus,
  { label: string; badgeClass: string }
> = {
  active: {
    label: "재직",
    badgeClass: "border-status-done/40 bg-status-done/12 text-status-done-ink",
  },
  on_leave: {
    label: "휴직",
    badgeClass: "border-status-received/40 bg-status-received/15 text-status-received-ink",
  },
  terminated: {
    label: "퇴사",
    badgeClass: "border-status-cancelled/40 bg-status-cancelled/12 text-status-cancelled",
  },
};

export const EMPLOYMENT_STATUS_ORDER: EmploymentStatus[] = ["active", "on_leave", "terminated"];

/** 접근·로그인을 차단하는 전환(휴직/퇴사) — 확인 다이얼로그 대상. active 복귀는 즉시. */
export function isBlockingStatus(status: EmploymentStatus): boolean {
  return status !== "active";
}

// 생성 가능한 직원 5역할(patient 제외 — 환자는 Epic 3 자가가입).
export const STAFF_ROLE_CODES = ["reception", "doctor", "nurse", "radiologist", "admin"] as const;

export const STAFF_ROLE_OPTIONS = STAFF_ROLE_CODES.map((code) => ({
  code,
  label: ROLE_LABELS[code] ?? code,
}));

export const LICENSE_TYPE_OPTIONS: { value: LicenseType; label: string }[] = [
  { value: "doctor", label: "의사" },
  { value: "radiologist", label: "방사선사" },
];

export function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code;
}

// 이메일 형식 — FastAPI(_EMAIL_PATTERN)와 동일한 가벼운 shape. 권위는 GoTrue(중복·정밀 검증).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// 생성 폼 Zod 스키마 — Pydantic StaffCreate 의 거울(3중 검증의 클라 1선). 옵셔널은 "" 허용 후 제출 시 정규화.
// role_code/license_type 은 string + refine 로 두어 빈 기본값("")이 defaultValues 와 충돌하지 않게 한다.
// 옵셔널 필드는 `z.string()`(빈 문자열 허용)로 둔다 — RHF 컨트롤드 인풋이 항상 ""를 주므로 input/output
// 타입이 일치(`.optional().default()`는 input/output 발산 → resolver 타입 충돌). 제출 시 ""는 제거한다.
export const staffCreateSchema = z.object({
  employee_no: z.string().trim().min(1, "사번을 입력하세요").max(50),
  name: z.string().trim().min(1, "이름을 입력하세요").max(100),
  email: z.string().trim().regex(EMAIL_RE, "올바른 이메일 형식이 아닙니다").max(254),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다").max(72),
  role_code: z
    .string()
    .refine((v) => (STAFF_ROLE_CODES as readonly string[]).includes(v), "역할을 선택하세요"),
  license_no: z.string().trim().max(50),
  // `.includes()` 사용 — `v === "doctor" || …` 식은 TS 5.5 추론 타입가드로 출력이 리터럴 유니온으로
  // 좁혀져 zodResolver input/output 타입이 발산한다(출력을 string 으로 유지).
  license_type: z
    .string()
    .refine((v) => ["", "doctor", "radiologist"].includes(v), "면허종류가 올바르지 않습니다"),
  phone: z.string().trim().max(30),
  hire_date: z.string(),
});

export type StaffCreateValues = z.infer<typeof staffCreateSchema>;

/** 폼 값 → POST 페이로드. 빈 옵셔널 필드는 제거(서버 Literal/None 계약과 정합). 비밀번호는 그대로 1회 전송. */
export function toCreatePayload(values: StaffCreateValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    employee_no: values.employee_no,
    name: values.name,
    email: values.email,
    password: values.password,
    role_code: values.role_code,
  };
  if (values.license_no) payload.license_no = values.license_no;
  if (values.license_type) payload.license_type = values.license_type;
  if (values.phone) payload.phone = values.phone;
  if (values.hire_date) payload.hire_date = values.hire_date;
  return payload;
}
