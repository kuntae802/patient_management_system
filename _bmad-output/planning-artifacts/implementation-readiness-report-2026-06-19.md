---
stepsCompleted: [1, 2, 3, 4, 5, 6]
status: 'complete'
overallReadiness: 'READY'
date: '2026-06-19'
project_name: 'patient_management_system'
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-patient_management_system-2026-06-18/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/ux-designs/ux-patient_management_system-2026-06-19/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-patient_management_system-2026-06-19/EXPERIENCE.md
  - docs/project-context.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-06-19
**Project:** patient_management_system

## 1. Document Inventory

| 문서 유형 | 파일 | 형식 | 상태 |
|---|---|---|---|
| PRD | `prds/prd-patient_management_system-2026-06-18/prd.md` | whole | ✅ |
| Architecture | `architecture.md` | whole | ✅ |
| Epics & Stories | `epics.md` | whole | ✅ |
| UX Design (시각) | `ux-designs/.../DESIGN.md` | whole | ✅ |
| UX Design (동작) | `ux-designs/.../EXPERIENCE.md` | whole | ✅ |
| Project Context | `docs/project-context.md` | whole | ✅ (보조) |

**중복(whole+sharded 충돌):** 없음.
**누락 필수 문서:** 없음 (PRD·Architecture·Epics·UX 전부 존재).
**비고:** UX는 DESIGN.md(시각)+EXPERIENCE.md(동작) 2파일로 분리된 상보 산출물 — 중복이 아니라 의도된 역할 분담(충돌 시 EXPERIENCE spine 우선).

## 2. PRD Analysis

> PRD(`prd.md`) 완독. 전역 고유 번호(FR-NNN / NFR-NNN) 보존. 추출 전문은 `prd.md §5~7` 및 `epics.md §Requirements Inventory`와 1:1 일치.

### Functional Requirements (70개 / 18그룹)

| 그룹 | FR 범위 | 핵심 |
|---|---|---|
| 환자 신원·등록 | FR-001~006 | 앱 가입·원무 직접 등록·자동 연결·임상 프로필·보호자 |
| 예약 | FR-010~016 | 슬롯 예약·더블부킹 차단·SMS·노쇼 제한·휴진 재배정 |
| 접수·대기 | FR-020~023 | 내원 생성·walk-in·실시간 대기열·다음 호출 |
| 진찰 | FR-030~032 | 진료 시작·과거 이력·사전 입력 확인 |
| SOAP·진단 | FR-040~042 | SOAP 1:N·KCD 주/부진단 |
| 처방 오더 | FR-050~052 | 처방전·진단 연결·중복 경고 |
| 검사·영상 오더 | FR-060~061 | 오더·직역 워크리스트 분기 |
| 처치 오더 | FR-070 | 처치 오더 |
| 오더 공통 | FR-080~081 | 유형별 생명주기·수가 근거 |
| 간호 | FR-090~094 | 워크리스트·활력·수행·재수행 차단·일상 기록 |
| 방사선 | FR-100~103 | 촬영·영상 업로드·판독·장비 |
| 수납·정산 | FR-110~119 | 수가 집계·급여구분·결제·3대 문서·후/선수납·취소/부분 |
| 환자 포털 | FR-120~122 | 본인 내원·처방결과·수납 조회 |
| 마스터 | FR-200~203 | 진료과/코드 마스터·유효기간·강제·soft delete |
| RBAC | FR-210~215 | 역할·권한·분리 프로필·접근 제어·계정·재직 |
| 스케줄 | FR-220~221 | 근무표·휴진 예외 |
| 통계 | FR-230 | 운영 대시보드 |
| 보안 | FR-240~243 | RLS·암호화·감사 기록·감사 조회 |

**Total FRs: 70** (중간 번호는 PRD 의도대로 향후 삽입용 공백).

### Non-Functional Requirements (17개)

- NFR-001 조회 응답 ~2초(데모) / NFR-002 대기열·워크리스트 ≤5초 갱신
- NFR-010 직원 데스크톱 웹(Chromium) / NFR-011 환자 Android APK / NFR-012 Supabase(PostgreSQL)
- NFR-020 TLS / NFR-021 Supabase Auth·최소권한 RBAC / NFR-022 개인정보 표준 "형태" 모사(공식 인증 범위 밖)
- NFR-030 Supabase 관리형 백업 / NFR-031 데모 SLA 없음 [ASSUMPTION]
- NFR-040 상태 전이 규칙 강제 / NFR-041 마스터 무결성·트랜잭션 원자성 / NFR-042 감사 append-only
- NFR-050 다음 할 일 명시 / NFR-051 역할 범위 내 완결 / NFR-052 전면 한국어
- NFR-060 내원 허브 확장성(입원 갈래 수용)

**Total NFRs: 17**

### Additional Requirements (제약·가정)

- **확정 정책(2026-06-18):** 노쇼 임계 2회 · SMS/본인인증/결제 = 시뮬·기록만 · 영상 판독 진료의 겸임 · NFR 성능 2초 잠정.
- **다운스트림 이월:** ① 수가 코드별 상세 매핑·시드(아키텍처/수납 에픽 소유) ② 마스터 유효기간 컬럼(아키텍처 — 해소됨).
- **범위 제외:** 입원·외부 실연동(EDI/약국/검사 의뢰)·인증 완결성·응급/건강검진.

### PRD Completeness Assessment

- **완전성: 높음.** 70 FR이 내원 상태 흐름을 따라 묶이고 고통↔7기둥↔FR 추적성 표가 명시됨. 골든 패스 UJ-1이 6역할 end-to-end 합격선으로 정의됨.
- **명료성:** 용어집·상태머신·정책 확정값이 다운스트림 모호성을 제거. 잔여 이월 2건은 소유·재검토 시점이 명시되어 추적 가능.
- **검증 관점 유의:** 성능/사용성 NFR(001·002·050·051)은 데모 목표치 수준 — 측정 임계·프로토콜은 다운스트림(아키텍처가 인지). 구현 차단 사유 아님.

## 3. Epic Coverage Validation

> `epics.md` 완독. FR Coverage Map(70개 전수 매핑) + 스토리 AC 본문 자동 교차검증(grep) 결과를 대조.

### Coverage Matrix (그룹 단위 — 70 FR 전수)

| FR 범위 | 에픽 | 대표 스토리 | 상태 |
|---|---|---|---|
| FR-210~215, 240~243 | Epic 1 | 1.3·1.4·1.5·1.6·1.7·1.8·1.9·1.10 | ✓ Covered |
| FR-200~203 | Epic 2 | 2.1·2.2·2.3·2.4 | ✓ Covered |
| FR-001~006 | Epic 3 | 3.1·3.2·3.3·3.4 | ✓ Covered |
| FR-020~023, 030~032, 040~042 | Epic 4 | 4.1~4.7 | ✓ Covered |
| FR-050~052, 060~061, 070, 080~081, 090~094, 100~103 | Epic 5 | 5.1~5.10 | ✓ Covered |
| FR-010~016, 220~221 | Epic 6 | 6.1~6.8 | ✓ Covered |
| FR-110~119 | Epic 7 | 7.1~7.10 | ✓ Covered |
| FR-120~122, 230 | Epic 8 | 8.1·8.2·8.3·8.5 | ✓ Covered |

**누락 FR(MISSING):** 없음. **양방향 검증:** 에픽에 있으나 PRD에 없는 FR(고아) 없음 — 모든 스토리 FR이 PRD로 역추적됨.

### Missing Requirements

- **Critical:** 없음.
- **High Priority:** 없음.
- (자동 교차검증: 스토리 AC 본문 등장 고유 FR = 70 / PRD 전체 = 70, 차집합 ∅.)

### Coverage Statistics

- Total PRD FRs: **70**
- FRs covered in epics: **70**
- **Coverage: 100%**
- (참고) UX-DR 24/24도 스토리 AC에 전수 매핑 — UX 정합은 다음 단계에서 상세 검증.

## 4. UX Alignment Assessment

### UX Document Status

**Found** — `DESIGN.md`(시각 정체성) + `EXPERIENCE.md`(동작 spine) 2파일 상보 구성. 6개 키 목업(`mockups/`) 포함.

### UX ↔ PRD 정합

- ✅ **여정 일치:** UX Key Flows(Flow A 대기판/정해린, B 진료허브/김도현, C 환자앱/이수진, Golden Path)가 PRD UJ-1과 6역할을 정확히 미러.
- ✅ **역할 사이트맵 일치:** reception/doctor/nurse/radiology/admin/(patient) = PRD 6역할.
- ✅ **컴포넌트↔FR 매핑:** 대기판=FR-022/023, 진료허브=FR-030~042, 오더패널=FR-050~103, 수납=FR-110~119, RBAC매트릭스=FR-210/211, 예약캘린더=FR-010~016, 환자앱=FR-120~122.
- ⚠️ **UX가 PRD를 초과한 지점(긍정적 강화):** **알레르기↔오더 교차검증**(체계적 1급 패턴)은 PRD의 FR-052(동일성분 중복)를 넘어선다 — EXPERIENCE 스스로 "현재 존재하는 건 FR-052뿐"이라 명시. → epics Story 5.5(UX-DR21)에 반영됨. 추적 가능하나 전용 PRD FR은 없음(향후 FR 승격 고려 가능).

### UX ↔ Architecture 정합

- ✅ 실시간(≤5초 대기판/워크리스트) → Supabase `postgres_changes`(아키텍처).
- ✅ 주민번호 reveal+감사 → pgcrypto+Vault+SECURITY DEFINER RPC+감사 트리거.
- ✅ next-action 1급 → 아키텍처 "다음 할 일 가이드 = 1급 패턴" AppShell.
- ✅ Ctrl K 팔레트·shadcn·폼 → 프론트 스택(shadcn Command/RHF/Zod).
- ✅ 서브패스 basePath 전파 → 아키텍처 basePath/root_path/프록시.
- ✅ stale 실시간 쓰기 가드·409 전이 → 아키텍처 에러 표준(409).

### Warnings (비차단 — 구현 시 확인 권장)

1. **낙관적 잠금/버전:** EXPERIENCE는 동시 수행/정산 경합에 "낙관적 잠금/버전 → 409"를 요구. 아키텍처의 1차 방어는 상태머신 재수행 차단(FR-093)이나, **행 버전 컬럼 기반 낙관적 동시성**은 스키마(0009 오더·0012 수납) 구현 시 명시 확인 필요. (미세 갭)
2. **알림 벨 콘텐츠 모델 OPEN:** UX가 위치·동작은 확정했으나 알림 타입·우선순위·읽음 처리는 spine-only(전용 목업 없음). 현재 Epic 1.2의 탑바 벨 슬롯만 존재 — 전용 스토리 없음. → 별도 스토리화 또는 명시적 보류 결정 필요. (이월)
3. **전용 목업 없는 화면:** 워크리스트·마스터 CRUD·대시보드·환자검색은 전용 목업 없이 대기판/진료허브 패턴 상속(UX 의도적 결정). epics 스토리(5.6/5.7·2.x·8.5·3.5)로 커버됨 — 수용 가능, 구현 시 패턴 일관성만 유지.

**결론:** UX↔PRD↔Architecture 정합 강함. 차단 이슈 없음. 위 3건은 구현 단계에서 확인할 비차단 항목.

## 5. Epic Quality Review

> create-epics-and-stories 모범사례 기준 엄격 적용. 제 산출물이라도 무관용 검토.

### Best Practices Compliance Checklist

| 점검 | 결과 |
|---|---|
| 에픽이 사용자 가치 전달(기술 마일스톤 아님) | ✅ (Epic 1 일부 예외 — 아래 Minor) |
| 에픽 독립성(Epic N이 N+1 불요) | ✅ |
| 스토리 적정 크기(단일 세션) | ✅ |
| 미래 의존 없음 | ⚠️ (2건 — 아래) |
| 테이블은 필요 시점 생성 | ⚠️ (1건 순서 — 아래 Major) |
| 명확한 인수 기준(G/W/T·테스트 가능) | ✅ |
| FR 추적성 유지 | ✅ (70/70) |

### 🔴 Critical Violations

- **없음.** 기술 레이어 에픽 없음(Init은 별도 에픽이 아닌 Story 1.1 = 스타터 템플릿 정식 예외). 에픽 단위 거대 스토리 없음. 순환 의존 없음.

### 🟠 Major Issues

1. **마이그레이션 0001 순서 역전 (실측 결함).** Story **1.9**가 `0001_extensions.sql`(pgcrypto·gen_random_uuid·Vault)을 소유하나, Story **1.3**(`0002~0004` 신원·RBAC·감사)이 **시퀀스상 먼저**이고 0001에 의존한다(UUID PK 기본값·마이그레이션 번호 순서). 0001을 1.9에서 만들면 1.3 구현 시 미존재.
   - **영향:** 스토리 순서대로 구현 시 1.3에서 막힘.
   - **권고:** `0001_extensions`를 **Story 1.1(Init, supabase 셋업) 또는 1.3 선두**로 이동. Story 1.9는 *주민번호 암복호 RPC·HMAC·reveal 패턴*만 소유(확장 활성화는 선행). create-story 단계에서 스토리 파일에 반영.

### 🟡 Minor Concerns

1. **오더 패널 셸 소유권 모호(미래 의존 위험).** Story **5.2**(처방 발행)가 "오더 패널에서"를 전제하나, 오더 패널 전체(탭·구조)는 Story **5.5**에 기술됨 → 5.2→5.5 전방 참조 소지.
   - **권고:** create-story에서 명확화 — **5.2가 오더 패널 셸+처방 탭을 생성**, 5.3/5.4가 각 탭 추가, **5.5는 교차검증·누락 디텍터 오버레이(강화 레이어)**. 이 해석이면 전방 의존 해소.
2. **Story 4.2 예약-접수 분기.** 4.2 첫 AC(예약 목록 접수)가 예약 데이터(Epic 6 산출)를 참조. **walk-in AC로 4.2는 독립 완결·시연 가능**하고 예약 분기는 가산적(Epic 6 시 활성). 하드 의존 아님 — 아키텍처의 의도된 Phase 2→4 순서. 구현 시 예약 분기는 stub/ready로.
3. **Epic 1의 기술-인에이블링 스토리.** 1.1(Init)·1.2(디자인 시스템)는 독립 사용자 가치 없음 — 단, **스타터 템플릿 정식 예외 + 디자인 토대**로 가치 전달형 파운데이션 에픽(로그인·RBAC·계정·감사) 내 전제 스토리. 수용 가능(독립 기술 에픽 아님).

### Remediation Summary

- **착수 전 1건(Major) 권장:** 0001 마이그레이션을 Story 1.1/1.3으로 이동(create-story 시).
- **create-story 시 명확화 2건(Minor):** 5.2/5.5 오더 패널 셸 소유, 4.2 예약 분기 stub.
- 나머지는 수용 — 차단 사유 아님.

## 6. Summary and Recommendations

### Overall Readiness Status

**READY (착수 가능)** — 차단(Critical) 이슈 0건. FR 커버리지 100%(70/70), UX-DR 100%(24/24), 문서 정합 강함. 발견된 항목은 전부 **다음 단계(create-story)에서 자연히 처리할 정제 사항**이며 계획 자체의 결함이 아니다.

### 발견 요약

| 카테고리 | Critical | Major | Minor/경고 |
|---|---|---|---|
| 문서 인벤토리 | 0 | 0 | 0 |
| PRD 분석 | 0 | 0 | 0 |
| FR 커버리지 | 0 | 0 | 0 |
| UX 정합 | 0 | 0 | 3 (경고) |
| 에픽 품질 | 0 | 1 | 3 |
| **합계** | **0** | **1** | **6** |

### Critical Issues Requiring Immediate Action

- **없음.** 즉시 착수를 막는 이슈 없음.

### Recommended Next Steps

1. **(Major) 마이그레이션 0001 순서 교정** — create-story로 Story 1.1/1.3·1.9를 구체화할 때, `0001_extensions`(pgcrypto·gen_random_uuid·Vault)를 **Story 1.1(Init) 또는 1.3 선두**로 배치하고, Story 1.9는 주민번호 RPC·HMAC·reveal만 소유하도록 명시.
2. **(Minor) 오더 패널 셸 소유 명확화** — Story 5.2 = 패널 셸+처방 탭 생성 / 5.5 = 안전 오버레이로 스토리 파일에 기술(5.2→5.5 전방 참조 제거).
3. **(Minor) Story 4.2 예약 분기 stub** — walk-in 경로로 독립 완결하고 예약-접수 분기는 Epic 6 활성까지 ready 처리 명시.
4. **(UX 경고) 구현 시 확인** — 낙관적 잠금용 행 버전 컬럼(0009·0012) / 알림 벨 콘텐츠 모델 스토리화 또는 명시 보류 / 무목업 화면 패턴 일관성.
5. **권장 진행 경로:** `bmad-sprint-planning` → `bmad-create-story`(Story 1.1부터, 위 1~3 정제 반영) → `bmad-dev-story`.

### Final Note

본 평가는 **2개 카테고리에서 7건**(Critical 0 · Major 1 · Minor/경고 6)을 식별했다. 차단 이슈가 없으므로 **즉시 착수 가능**하며, Major 1건과 Minor 2건은 create-story 단계에서 스토리 파일을 쓸 때 반영하면 된다. 계획 산출물(PRD·UX·아키텍처·에픽·project-context)은 일관되고 추적 가능하며 구현 준비가 되었다.

**평가자:** 구현 준비도 검증 워크플로우 (Product Manager 역할) · **일자:** 2026-06-19
