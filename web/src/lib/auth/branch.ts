// 분리 프로필 분기 — 로그인 후 착지 경로 결정.
// Story 1.4 §결정 D-1: 직원 판정은 auth_user_role() non-null(= users 행 보유, active).
// 비직원은 일괄 환자 영역(현재 실제 환자/자가가입은 Epic 3, 포털은 Epic 8).

export const LOGIN_PATH = "/login";
export const STAFF_HOME = "/home"; // (staff) 영역 — 역할별 화면은 Epic 4+가 대체
export const PATIENT_HOME = "/portal"; // (patient) 영역 placeholder

/**
 * 로그인 후 착지 경로.
 * @param role `auth_user_role()` 결과 — active 직원의 역할 코드, 비직원이면 null/undefined.
 */
export function landingPathForRole(role: string | null | undefined): string {
  return role ? STAFF_HOME : PATIENT_HOME;
}
