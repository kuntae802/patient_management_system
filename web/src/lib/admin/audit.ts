// 감사 로그 뷰어(Story 1.10) 공용 타입·메타·마스킹. API 응답은 snake_case 유지(전 경로 일관).
// 읽기전용 — append-only 는 DB(0004)가 강제하고 뷰어는 SELECT 결과만 표시한다.

export type AuditAction = "create" | "read" | "update" | "delete" | "login";

/** FastAPI AuditLogEntry 의 거울(snake_case). before/after = 변경 전/후 전체행 스냅샷(jsonb). */
export type AuditLogEntry = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_employee_no: string | null;
  action: AuditAction;
  target_table: string;
  target_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
};

export type AuditPageMeta = { page: number; page_size: number; total: number };
export type AuditLogPage = { data: AuditLogEntry[]; meta: AuditPageMeta };

/**
 * 동작 표시 메타 — 색 + 글리프 + 라벨로 3중 인코딩(음영/색 단독 의존 금지, UX-DR20).
 * glyph 는 장식(aria-hidden), 의미는 label 이 전달한다. read=PII reveal(복호)이라 별도 색으로 강조.
 */
export const ACTION_META: Record<
  AuditAction,
  { label: string; glyph: string; badgeClass: string }
> = {
  create: {
    label: "생성",
    glyph: "+",
    badgeClass: "border-status-done/40 bg-status-done/12 text-status-done-ink",
  },
  read: {
    label: "조회",
    glyph: "◉",
    badgeClass:
      "border-status-inprogress/40 bg-status-inprogress/12 text-status-inprogress",
  },
  update: {
    label: "수정",
    glyph: "~",
    badgeClass:
      "border-status-received/40 bg-status-received/15 text-status-received-ink",
  },
  delete: {
    label: "삭제",
    glyph: "✕",
    badgeClass:
      "border-status-cancelled/40 bg-status-cancelled/12 text-status-cancelled",
  },
  login: {
    label: "로그인",
    glyph: "→",
    badgeClass:
      "border-status-scheduled/40 bg-status-scheduled/12 text-status-scheduled",
  },
};

export const ACTION_ORDER: AuditAction[] = [
  "create",
  "read",
  "update",
  "delete",
  "login",
];

// 현재 트리거·reveal 이 기록하는 대상 테이블(0004/0005). 미래 도메인 테이블은 raw 값 폴백으로 표시.
export const TARGET_TABLE_LABELS: Record<string, string> = {
  roles: "역할",
  permissions: "권한",
  role_permissions: "역할-권한",
  users: "직원",
};

export const KNOWN_TARGET_TABLES = Object.keys(TARGET_TABLE_LABELS);

export function targetTableLabel(table: string): string {
  return TARGET_TABLE_LABELS[table] ?? table;
}

/** 행위자 표시명 — 이름(사번). NULL=시스템(GUC 미주입). 조인 미스(환자·삭제 직원)=불투명 id 일부. */
export function actorLabel(entry: AuditLogEntry): string {
  if (entry.actor_id === null) return "시스템";
  if (entry.actor_name) {
    return entry.actor_employee_no
      ? `${entry.actor_name} (${entry.actor_employee_no})`
      : entry.actor_name;
  }
  return `미상 (${entry.actor_id.slice(0, 8)}…)`;
}

// 항상-민감 키(table-agnostic) — 연락처·건강민감(임상 프로필·SOAP)·암호/비밀. 스냅샷 표시 단 차단(UX-DR22, Story 3.6).
// SOAP(subjective/objective/assessment/plan) = medical_records 자유텍스트(Story 4.6).
// allergy_override_reason = prescription_details 알레르기 오버라이드 사유 자유텍스트(Story 5.5).
// 서버측 마스킹(services/audit.py `_SENSITIVE_KEY`)이 1차 권위 — 이 정규식은 방어심층이며 **동일 키
// 집합으로 유지**(한쪽만 바꾸면 드리프트).
const SENSITIVE_KEY =
  /(resident_no|rrn|ssn|password|passwd|secret|token|email|phone|address|guardian|allergies|chronic_diseases|medications|notes|insurance_no|subjective|objective|assessment|plan|allergy_override_reason|_enc$|_hash$|_blind_index$|ciphertext)/i;

// `name` 은 테이블 의존 — 환자/보호자만 PII(masters 진료과명·roles 라벨은 비-PII). 서버 거울.
export const PII_NAME_TABLES = new Set(["patients", "guardians"]);

const MASK_DISPLAY = "●●●● (마스킹됨)";

// 중첩 객체/배열 내부의 민감 키까지 마스킹 — 최상위 키가 비민감이어도 안쪽 PII(예: guardian.phone,
// addresses[])가 JSON.stringify 로 평문 덤프되지 않게 재귀 치환(미래 환자 스냅샷 누출 표면 봉쇄).
function maskDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        SENSITIVE_KEY.test(k) ? [k, MASK_DISPLAY] : [k, maskDeep(v)],
      ),
    );
  }
  return value;
}

/** 스냅샷 값 마스킹 — 민감 키면 마스킹 표시. 비민감 객체는 내부까지 재귀 마스킹 후 직렬화.
 *  `maskName`(대상이 patients/guardians)이면 `name` 키도 PII 로 마스킹(서버 거울, Story 3.6). */
export function maskSnapshotValue(
  key: string,
  value: unknown,
  opts?: { maskName?: boolean },
): { masked: boolean; display: string } {
  const sensitive =
    SENSITIVE_KEY.test(key) ||
    (opts?.maskName === true && key.toLowerCase() === "name");
  if (sensitive) return { masked: true, display: MASK_DISPLAY };
  if (value === null || value === undefined)
    return { masked: false, display: "—" };
  if (typeof value === "object")
    return { masked: false, display: JSON.stringify(maskDeep(value)) };
  return { masked: false, display: String(value) };
}

export type DiffKind = "added" | "removed" | "changed" | "unchanged";
export type SnapshotDiffRow = {
  key: string;
  before: unknown;
  after: unknown;
  kind: DiffKind;
};

/** 전/후 스냅샷 → 키별 diff 행(키 정렬). create=전부 added, delete=전부 removed, update=changed/unchanged. */
export function diffSnapshot(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): SnapshotDiffRow[] {
  const keys = Array.from(
    new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ).sort();
  return keys.map((key) => {
    const inB = before != null && key in before;
    const inA = after != null && key in after;
    const b = before?.[key];
    const a = after?.[key];
    let kind: DiffKind;
    if (inB && !inA) kind = "removed";
    else if (!inB && inA) kind = "added";
    else
      kind = JSON.stringify(b) === JSON.stringify(a) ? "unchanged" : "changed";
    return { key, before: b, after: a, kind };
  });
}

/** diff 행 종류 표시 메타 — 색 + 글리프 중복 인코딩(색 단독 금지, UX-DR20). */
export const DIFF_KIND_META: Record<
  DiffKind,
  { glyph: string; className: string; label: string }
> = {
  added: { glyph: "+", className: "text-status-done-ink", label: "추가" },
  removed: { glyph: "−", className: "text-status-cancelled", label: "삭제" },
  changed: { glyph: "~", className: "text-status-received-ink", label: "변경" },
  unchanged: { glyph: "·", className: "text-muted-foreground", label: "유지" },
};

// KST(Asia/Seoul) 표시 — timestamptz(UTC 저장)를 Intl ko-KR 로 변환(날짜 규칙, project-context).
const TIME_FMT = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Asia/Seoul",
});

export function formatAuditTime(iso: string): string {
  return TIME_FMT.format(new Date(iso));
}
