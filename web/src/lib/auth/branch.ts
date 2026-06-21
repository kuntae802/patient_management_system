// 분리 프로필 분기 — 로그인 후 착지 경로 결정.
// Story 1.4 §결정 D-1: 직원 판정은 auth_user_role()가 직원 역할 코드를 돌려줄 때.
// 비직원(역할 null 또는 'patient')은 환자 영역(현재 실제 환자/자가가입은 Epic 3, 포털은 Epic 8).

export const LOGIN_PATH = "/login";
export const SIGNUP_PATH = "/signup"; // (auth) 환자 자가가입(Story 3.4) — 미인증 공개 경로
export const STAFF_HOME = "/home"; // (staff) 영역 — 역할별 화면은 Epic 4+가 대체
export const PATIENT_HOME = "/portal"; // (patient) 영역 placeholder

// 직원 역할(roles.code). 'patient'은 roles에 존재하지만 직원이 아니므로 제외.
export const STAFF_ROLES = new Set(["reception", "doctor", "nurse", "radiologist", "admin"]);

/** 주어진 역할이 직원 역할인지. (null/undefined/'patient' → false) */
export function isStaffRole(role: string | null | undefined): boolean {
  return !!role && STAFF_ROLES.has(role);
}

/**
 * 로그인 후 착지 경로.
 * @param role `auth_user_role()` 결과 — active 직원의 역할 코드, 비직원이면 null/undefined.
 */
export function landingPathForRole(role: string | null | undefined): string {
  return isStaffRole(role) ? STAFF_HOME : PATIENT_HOME;
}
