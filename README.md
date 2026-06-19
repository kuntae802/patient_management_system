# 환자 관리 시스템 (Patient Management System, PMS)

수십 년 업력의 지역 중소병원이 **세대교체** 국면에서 겪는 문제 — 베테랑의 머릿속에만 있던 외래 운영 워크플로우(**암묵지**)가 사람이 바뀌며 무너지는 것 — 를 풀기 위한 **외래 운영 관리 시스템**. 한 번의 내원(Encounter)을 예약부터 수납까지 **명시적·역할별 파이프라인**으로 만들어, 워크플로우가 사람의 기억이 아니라 **시스템 안에** 살게 한다.

> 설계 중심 인물 = **신규 직원**. 모든 화면의 합격 기준은 "선배 없이도 제대로 일할 수 있는가".

## 범위

- **외래(Outpatient) 한 줄기 end-to-end** (약 26개 테이블). 입원은 차기 단계.
- **6역할:** 원무·의사·간호사·방사선사·관리자 + 환자.
- 직원 = 데스크톱 웹 / 환자 = 모바일 앱(APK).
- 합격선 = **골든 패스(UJ-1)**: 예약→접수→진료→수행→수납→조회가 6역할을 가로질러 끊김 없이 완주.

## 기술 스택

| 레이어 | 기술 |
|---|---|
| 데이터·인증·스토리지 | **Supabase** (PostgreSQL · Auth ES256/JWKS · Storage · Realtime) — RLS·트리거·제약을 DB가 강제 |
| 애플리케이션 | **FastAPI** (Python 3.13, uv) — 다단계 명령 오케스트레이션 |
| 직원 웹 + 환자 포털 | **Next.js 16** (React 19.2 · TS · Tailwind 4 · shadcn/ui) |
| 환자 모바일 | **Flutter** (webview 셸 → APK) |

배포: 홈서버 Docker Compose + Supabase 클라우드, 리버스 프록시 + Let's Encrypt, 서브패스 `/patient_management_system`.

## 모노레포 구조 (계획)

```
patient_management_system/
├── supabase/   # 스키마 단일 소유: migrations · RLS · 트리거 · pgcrypto · seed
├── api/        # FastAPI (uv) — 오케스트레이션
├── web/        # Next.js 16 — 직원앱 + 환자 포털
├── mobile/     # Flutter 웹뷰 셸 (환자 APK)
├── docs/       # project-context.md · glossary.md
└── _bmad-output/planning-artifacts/   # 기획 산출물 (아래)
```

> 코드 디렉토리(`supabase/ api/ web/ mobile/`)는 구현 Story 1.1(Init)에서 생성된다.

## 계획 산출물 (Planning Artifacts)

이 프로젝트는 BMad 방법론으로 계획되었다. 구현 착수 전 전 산출물이 완성·검증됨:

| 문서 | 위치 |
|---|---|
| 제품 브리프 | `_bmad-output/planning-artifacts/briefs/` |
| **PRD** (FR-001~243) | `_bmad-output/planning-artifacts/prds/` |
| **아키텍처 결정** | `_bmad-output/planning-artifacts/architecture.md` |
| **UX 디자인** (시각·동작) | `_bmad-output/planning-artifacts/ux-designs/` |
| **에픽 & 스토리** (8에픽·60스토리) | `_bmad-output/planning-artifacts/epics.md` |
| **구현 준비도 검증** (READY) | `_bmad-output/planning-artifacts/implementation-readiness-report-*.md` |
| **AI 에이전트 규칙** | `docs/project-context.md` |

## 현재 상태

🟢 **계획 페이즈 완료 · 구현 준비도 READY** — 다음: 스프린트 계획 → Story 1.1(Init) 구현 착수.

개발은 의미 있는 단위마다 단계별 커밋으로 진행한다.
