import {
  Activity,
  BarChart3,
  BellRing,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Database,
  FileText,
  LayoutDashboard,
  ListChecks,
  MonitorCog,
  Receipt,
  ScanLine,
  ScrollText,
  Search,
  ShieldCheck,
  Upload,
  UserPlus,
  UserRoundPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type StaffRole = "reception" | "doctor" | "nurse" | "radiologist" | "admin";

export const ALL_STAFF_ROLES: StaffRole[] = [
  "reception",
  "doctor",
  "nurse",
  "radiologist",
  "admin",
];

export type NavItem = {
  section: string;
  label: string;
  icon: LucideIcon;
  href: string;
  roles: StaffRole[];
  /** 지정 시 이 권한 보유자에게만 노출(미지정이면 역할만으로 노출). */
  requiredPermission?: string;
};

// 6역할 사이트맵(UX-DR24). href 는 basePath 없는 앱-내 경로(<Link>·basePath 가 자동 전파).
// 역할별 화면은 Epic 4+ 가 채운다 — 여기선 메뉴 정의만(현재 클릭 시 404 가능, 정상).
// 노출 모델(코드리뷰 결정): **직무 핵심 항목 = 역할로 노출**(원무의 환자 등록·검색·수납처럼 그 역할의
//   본질 업무는 권한 게이트 없이 보인다), **민감·관리 항목 = requiredPermission 게이트**(권한·감사·마스터·
//   대시보드·직원 계정 등 admin 관리 메뉴만; 1.7 권한 매트릭스 토글로 동적). 진짜 민감 동작(주민번호 reveal 등)은
//   해당 화면 안의 액션 게이트(PermissionGate)가 담당.
export const STAFF_NAV: NavItem[] = [
  // ── 원무(reception) — 접수·환자·정산은 직무 본질 → 역할로 노출 ──
  { section: "운영", label: "대기 현황", icon: LayoutDashboard, href: "/reception/waiting", roles: ["reception"] },
  { section: "운영", label: "접수", icon: UserPlus, href: "/reception/intake", roles: ["reception"] },
  { section: "운영", label: "예약 관리", icon: CalendarDays, href: "/reception/schedule", roles: ["reception"] },
  { section: "운영", label: "리마인더", icon: BellRing, href: "/reception/reminders", roles: ["reception"] },
  { section: "환자", label: "환자 등록", icon: UserRoundPlus, href: "/reception/register", roles: ["reception"] },
  { section: "환자", label: "환자 검색", icon: Search, href: "/patients", roles: ["reception"] },
  { section: "정산", label: "수납", icon: Wallet, href: "/reception/billing", roles: ["reception"] },
  { section: "정산", label: "수납 내역", icon: Receipt, href: "/reception/billing/history", roles: ["reception"] },

  // ── 의사(doctor) ──
  { section: "진료", label: "진료 대기", icon: ClipboardList, href: "/doctor/waiting", roles: ["doctor"] },
  { section: "진료", label: "판독", icon: ScanLine, href: "/doctor/radiology", roles: ["doctor"] },
  { section: "환자", label: "환자 검색", icon: Search, href: "/patients", roles: ["doctor"] },

  // ── 간호사(nurse) — 활력징후·처치·간호기록은 직무 본질 → 역할로 노출 ──
  { section: "진료", label: "처치 워크리스트", icon: ListChecks, href: "/nurse/worklist", roles: ["nurse"] },
  { section: "진료", label: "활력징후 입력", icon: Activity, href: "/nurse/vitals", roles: ["nurse"] },
  { section: "진료", label: "간호기록", icon: FileText, href: "/nurse/notes", roles: ["nurse"] },

  // ── 방사선사(radiologist) ──
  { section: "영상", label: "촬영 워크리스트", icon: ScanLine, href: "/radiology/worklist", roles: ["radiologist"] },
  { section: "영상", label: "영상 업로드", icon: Upload, href: "/radiology/upload", roles: ["radiologist"] },
  { section: "영상", label: "장비 관리", icon: MonitorCog, href: "/radiology/equipment", roles: ["radiologist"] },

  // ── 관리자(admin) ──
  { section: "관리", label: "운영/대시보드", icon: BarChart3, href: "/admin/dashboard", roles: ["admin"], requiredPermission: "dashboard.read" },
  { section: "관리", label: "마스터", icon: Database, href: "/admin/masters", roles: ["admin"], requiredPermission: "master.manage" },
  { section: "관리", label: "권한", icon: ShieldCheck, href: "/admin/permissions", roles: ["admin"], requiredPermission: "rbac.manage" },
  { section: "관리", label: "근무 스케줄", icon: CalendarClock, href: "/admin/schedule", roles: ["admin"], requiredPermission: "master.manage" },
  { section: "관리", label: "직원 계정", icon: Users, href: "/admin/users", roles: ["admin"], requiredPermission: "user.manage" },
  { section: "관리", label: "감사 로그", icon: ScrollText, href: "/admin/audit-logs", roles: ["admin"], requiredPermission: "audit.read" },
];

// 전 직원 공통 푸터. (설정·도움말은 미구현 — 페이지 신설 시 추가. 현재 빈 목록 = 죽은 링크 제거.)
export const STAFF_FOOTER_NAV: NavItem[] = [];

// 역할 한글 표시명(0002 roles.name 과 일치).
export const ROLE_LABELS: Record<string, string> = {
  reception: "원무과",
  doctor: "의사",
  nurse: "간호사",
  radiologist: "방사선사",
  admin: "관리자",
  patient: "환자",
};

// 노출 규칙: 역할 매칭(IA) AND (requiredPermission 없거나 보유). 권한 0 역할도 자기 무권한 항목은 본다.
export function filterNav(
  items: NavItem[],
  role: string | null,
  has: (code: string) => boolean,
): NavItem[] {
  if (!role) return [];
  return items.filter(
    (it) =>
      it.roles.includes(role as StaffRole) &&
      (!it.requiredPermission || has(it.requiredPermission)),
  );
}
