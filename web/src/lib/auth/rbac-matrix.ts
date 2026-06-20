import type { SupabaseClient } from "@supabase/supabase-js";

// 권한 매트릭스(역할 × 권한) 데이터 — Supabase 직접 조회(authenticated SELECT, 0003 정책). 쓰기는 FastAPI.
// ⚠️ 코드는 전 경로 snake_case 유지(camelCase 변환 금지). 매트릭스 *읽기*는 보안 경계 아님(카탈로그 가독).

export type MatrixRole = { code: string; name: string };
export type MatrixPermission = { code: string; name: string; resource: string };
export type PermissionMatrix = {
  /** 직원 5역할(매트릭스 열 순서, admin 최후미·고정). patient 제외. */
  roles: MatrixRole[];
  /** 권한 전수(resource 그룹 → code 정렬). DB 카탈로그가 진실(하드코딩 금지). */
  permissions: MatrixPermission[];
  /** 부여된 (역할,권한) 쌍 — `"<roleCode>:<permCode>"`. 직렬화 가능(클라에서 Set 구성). */
  grants: string[];
};

// 매트릭스 열 순서(admin 최후미·고정). patient 역할은 직무 RBAC 대상이 아니므로 제외.
export const MATRIX_ROLE_ORDER = ["reception", "doctor", "nurse", "radiologist", "admin"];
export const ADMIN_ROLE = "admin";

// 민감 권한(현 카탈로그) — 토글 시 확인 다이얼로그 필수(UX-DR16). 카탈로그 확장 시 여기 추가.
// (AC3의 "환자 삭제·수가 조정"은 아직 permissions 카탈로그에 부재 → 등장 시 등록.)
export const SENSITIVE_PERMISSIONS = new Set<string>([
  "patient.reveal_rrn",
  "rbac.manage",
  "audit.read",
]);

// resource → 한글 도메인 라벨(그룹 헤더용 UI 라벨). 누락 resource 는 코드로 폴백.
export const RESOURCE_LABELS: Record<string, string> = {
  patient: "환자",
  encounter: "내원/접수",
  medical_record: "진료기록",
  diagnosis: "진단",
  prescription: "처방",
  examination: "검사·영상",
  treatment: "처치",
  vital: "활력징후",
  appointment: "예약",
  payment: "수납",
  master: "마스터",
  dashboard: "대시보드",
  user: "직원 계정",
  rbac: "권한",
  audit: "감사",
};

const RESOURCE_ORDER = Object.keys(RESOURCE_LABELS);

export function grantKey(roleCode: string, permCode: string): string {
  return `${roleCode}:${permCode}`;
}

export function resourceLabel(resource: string): string {
  return RESOURCE_LABELS[resource] ?? resource;
}

function resourceRank(resource: string): number {
  const i = RESOURCE_ORDER.indexOf(resource);
  return i === -1 ? RESOURCE_ORDER.length : i;
}

// PostgREST many-to-one 임베드는 객체({code})지만 타입 추론이 배열일 수 있어 양쪽 방어(permissions.ts 선례).
function embedCode(value: { code: string } | { code: string }[] | null): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0]?.code : value.code;
}

/**
 * 매트릭스 데이터를 Supabase 직접 조회로 구성. roles(patient 제외·순서)·permissions(전수·정렬)·
 * role_permissions(전수, roles/permissions 코드 임베드 → grant 쌍).
 */
export async function fetchPermissionMatrix(supabase: SupabaseClient): Promise<PermissionMatrix> {
  const [rolesRes, permsRes, grantsRes] = await Promise.all([
    supabase.from("roles").select("code, name"),
    supabase.from("permissions").select("code, name, resource"),
    supabase.from("role_permissions").select("roles(code), permissions(code)"),
  ]);

  // ⚠️ fail-loud: 에러를 []로 강등하면 grant가 있는데도 '전부 차단' 거짓 매트릭스를 진실처럼 렌더해
  //   관리자가 오판(재grant) 위험. 셸 권한 게이트(permissions.ts)는 fail-closed가 안전하지만,
  //   관리 *편집* 화면은 거짓 상태보다 명시적 실패(RSC 에러)가 안전하다.
  const firstError = rolesRes.error ?? permsRes.error ?? grantsRes.error;
  if (firstError) {
    throw new Error(`권한 매트릭스 조회 실패: ${firstError.message}`);
  }
  const roleRows = rolesRes.data;
  const permRows = permsRes.data;
  const grantRows = grantsRes.data;

  const roleNameByCode = new Map((roleRows ?? []).map((r) => [r.code as string, r.name as string]));
  const roles: MatrixRole[] = MATRIX_ROLE_ORDER.filter((c) => roleNameByCode.has(c)).map((c) => ({
    code: c,
    name: roleNameByCode.get(c) as string,
  }));

  const permissions: MatrixPermission[] = ((permRows ?? []) as MatrixPermission[])
    .map((p) => ({ code: p.code, name: p.name, resource: p.resource }))
    .sort(
      (a, b) => resourceRank(a.resource) - resourceRank(b.resource) || a.code.localeCompare(b.code),
    );

  const grants = ((grantRows ?? []) as Array<{
    roles: { code: string } | { code: string }[] | null;
    permissions: { code: string } | { code: string }[] | null;
  }>)
    .map((row) => {
      const rc = embedCode(row.roles);
      const pc = embedCode(row.permissions);
      return rc && pc ? grantKey(rc, pc) : undefined;
    })
    .filter((k): k is string => typeof k === "string");

  return { roles, permissions, grants };
}
