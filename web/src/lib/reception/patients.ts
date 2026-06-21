import { z } from "zod";

import { apiFetch } from "@/lib/api/client";

// 환자 등록(Story 3.1) — 타입·Zod 스키마(Pydantic PatientCreate 거울)·페이로드 변환.
// 읽기/쓰기 모두 FastAPI(apiFetch). 주민번호는 raw 로 서버에 보내고(서버가 정규화·암호화), 클라는
// HARD 사전체크(3중 검증 1선)만 한다. 🚫 raw 주민번호는 로그·toast 에 남기지 않는다(PII 경계).

export type InsuranceType = "health_insurance" | "medical_aid" | "auto_insurance" | "self_pay";

export const INSURANCE_TYPES: { value: InsuranceType; label: string }[] = [
  { value: "health_insurance", label: "건강보험" },
  { value: "medical_aid", label: "의료급여" },
  { value: "auto_insurance", label: "자동차보험" },
  { value: "self_pay", label: "일반(비급여)" },
];

const INSURANCE_VALUES: string[] = INSURANCE_TYPES.map((t) => t.value);

/** FastAPI PatientResponse 거울(snake_case 유지 — camelCase 변환 금지). 민감정보는 마스킹뿐.
 *  임상 5필드(Story 3.2)는 상세 응답에 포함(목록 PatientListItem 엔 없음). */
export type Patient = {
  id: string;
  chart_no: string;
  name: string;
  birth_date: string;
  sex: string;
  resident_no_masked: string;
  phone: string | null;
  address: string | null;
  email: string | null;
  insurance_type: string;
  insurance_no: string | null;
  blood_type: string | null;
  allergies: string | null;
  chronic_diseases: string | null;
  medications: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** 환자 목록 경량 항목(FastAPI PatientListItem 거울 — snake_case 유지). 마스킹·식별 단서만(검색·확인용).
 *  Patient(상세)와 별개: 임상·연락처(주소/이메일/보험) 없음. */
export type PatientListItem = {
  id: string;
  chart_no: string;
  name: string;
  birth_date: string;
  sex: string;
  resident_no_masked: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
};

/** 목록 페이지 봉투(아키텍처 §Format: {data, meta:{page,page_size,total}}). */
export type PatientPage = {
  data: PatientListItem[];
  meta: { page: number; page_size: number; total: number };
};

/** 전역 환자 검색(Story 3.5) — 이름·차트번호·연락처로 `GET /v1/patients?q=`. 상위 pageSize 건만.
 *  abort 가능(빠른 타이핑 시 이전 요청 취소 — 경쟁 결과 방지). 🚫 검색어(q=이름·연락처 PII)는
 *  로그·toast 에 남기지 않는다(서버 라우트도 동일 — 라우트는 불투명, 응답은 마스킹). */
export async function searchPatients(
  q: string,
  signal?: AbortSignal,
  pageSize = 20,
): Promise<PatientListItem[]> {
  const page = await apiFetch<PatientPage>(
    `/v1/patients?q=${encodeURIComponent(q)}&page_size=${pageSize}`,
    { signal },
  );
  return page.data;
}

// ── 혈액형(ABO+Rh) 폐쇄 어휘 — Pydantic BloodType Literal 의 거울 ───────────────
export type BloodType = "A+" | "A-" | "B+" | "B-" | "O+" | "O-" | "AB+" | "AB-";

export const BLOOD_TYPES: BloodType[] = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
const BLOOD_VALUES: string[] = BLOOD_TYPES;

/** 혈액형 표시 — 빈 값/미상은 "미확인". 폐쇄어휘는 그대로 표기. */
export function bloodTypeLabel(value: string | null): string {
  return value ? value : "미확인";
}

// ── 주민번호 검증(클라 1선 — services/rrn 의 거울) ─────────────────────────────
// 성별·세기 자리 → 출생 세기. 9·0(1800년대)은 HARD 범위(1–8) 밖이라 제외(서버와 동일).
const CENTURY_BY_GENDER: Record<number, number> = {
  1: 1900, 2: 1900, 5: 1900, 6: 1900,
  3: 2000, 4: 2000, 7: 2000, 8: 2000,
};
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const CHECKSUM_WEIGHTS = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];

/** 하이픈·공백 등 비숫자 제거(검증/전송 공용 정규화). */
export function normalizeRrn(raw: string): string {
  return (raw ?? "").replace(/\D/g, "");
}

function isValidBirthdate(d: string): boolean {
  const gender = Number(d[6]);
  const century = CENTURY_BY_GENDER[gender];
  if (century === undefined) return false;
  const year = century + Number(d.slice(0, 2));
  const month = Number(d.slice(2, 4));
  const day = Number(d.slice(4, 6));
  if (month < 1 || month > 12 || day < 1) return false;
  let max = DAYS_IN_MONTH[month - 1];
  if (month === 2 && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) max = 28;
  return day <= max;
}

/** HARD(형식·성별/세기 자리·생년월일). 통과 시 null, 실패 시 한국어 메시지(차단). */
export function rrnHardError(raw: string): string | null {
  const d = normalizeRrn(raw);
  if (d.length !== 13) return "주민등록번호 13자리를 정확히 입력하세요";
  if (!(Number(d[6]) in CENTURY_BY_GENDER)) return "성별·세기 자리가 올바르지 않습니다";
  if (!isValidBirthdate(d)) return "생년월일이 올바르지 않습니다";
  return null;
}

/** 체크섬 일치 여부(SOFT — 불일치라도 차단하지 않음, 2020 개편 대비). 형식 오류는 HARD 가 처리. */
export function rrnChecksumOk(raw: string): boolean {
  const d = normalizeRrn(raw);
  if (d.length !== 13) return true;
  const total = CHECKSUM_WEIGHTS.reduce((s, w, i) => s + Number(d[i]) * w, 0);
  return (11 - (total % 11)) % 10 === Number(d[12]);
}

// ── 검증(Zod) — Pydantic PatientCreate 의 거울(3중 검증 클라 1선) ──────────────
// 옵셔널은 "" 허용 후 제출 시 정규화. insurance_type 은 staff.ts 관례대로 string+refine(빈 기본값 호환).
export const patientCreateSchema = z.object({
  resident_no: z
    .string()
    .trim()
    .min(1, "주민등록번호를 입력하세요")
    .superRefine((v, ctx) => {
      const err = rrnHardError(v);
      if (err) ctx.addIssue({ code: "custom", message: err });
    }),
  name: z.string().trim().min(1, "이름을 입력하세요").max(100),
  phone: z.string().trim().max(20),
  address: z.string().trim().max(300),
  // 이메일 형식(서버 Pydantic _EMAIL_RE 의 거울) — 빈 값은 옵셔널 허용, 채우면 형식 검증.
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "이메일 형식이 올바르지 않습니다"),
  insurance_type: z.string().refine((v) => INSURANCE_VALUES.includes(v), "보험유형을 선택하세요"),
  insurance_no: z.string().trim().max(50),
});
export type PatientCreateValues = z.infer<typeof patientCreateSchema>;

/** 생성 페이로드. 빈 옵셔널은 제거(서버 None 계약). resident_no 는 raw 전송(서버가 정규화·암호화). */
export function toPatientCreatePayload(v: PatientCreateValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    resident_no: v.resident_no,
    name: v.name,
    insurance_type: v.insurance_type,
  };
  if (v.phone) payload.phone = v.phone;
  if (v.address) payload.address = v.address;
  if (v.email) payload.email = v.email;
  if (v.insurance_no) payload.insurance_no = v.insurance_no;
  return payload;
}

/** 보험유형 코드 → 한글 표시명. */
export function insuranceLabel(value: string): string {
  return INSURANCE_TYPES.find((t) => t.value === value)?.label ?? value;
}

/** 성별 코드 → 한글. */
export function sexLabel(sex: string): string {
  return sex === "male" ? "남" : sex === "female" ? "여" : sex;
}

// ── 임상 프로필(Story 3.2) — Zod 스키마(Pydantic PatientClinicalProfileUpdate 거울, 3중 검증 1선) ──
// blood_type 은 폐쇄어휘(빈 값=미상 허용), 자유텍스트 4종은 max_length 가드만(서버 거울).
export const clinicalProfileSchema = z.object({
  blood_type: z
    .string()
    .refine((v) => !v || BLOOD_VALUES.includes(v), "혈액형을 선택하세요"),
  allergies: z.string().trim().max(1000, "1000자 이내로 입력하세요"),
  chronic_diseases: z.string().trim().max(1000, "1000자 이내로 입력하세요"),
  medications: z.string().trim().max(1000, "1000자 이내로 입력하세요"),
  notes: z.string().trim().max(2000, "2000자 이내로 입력하세요"),
});
export type ClinicalProfileValues = z.infer<typeof clinicalProfileSchema>;

/** 환자 → 폼 기본값(현재값 프리필). null → "" (빈 입력). */
export function toClinicalProfileValues(p: Patient): ClinicalProfileValues {
  return {
    blood_type: p.blood_type ?? "",
    allergies: p.allergies ?? "",
    chronic_diseases: p.chronic_diseases ?? "",
    medications: p.medications ?? "",
    notes: p.notes ?? "",
  };
}

/** 갱신 페이로드(PUT 전체 교체). 빈 값은 null 로 전송(서버 None=값없음 계약 — 명시 삭제 지원). */
export function toClinicalProfilePayload(v: ClinicalProfileValues): Record<string, unknown> {
  return {
    blood_type: v.blood_type || null,
    allergies: v.allergies || null,
    chronic_diseases: v.chronic_diseases || null,
    medications: v.medications || null,
    notes: v.notes || null,
  };
}
