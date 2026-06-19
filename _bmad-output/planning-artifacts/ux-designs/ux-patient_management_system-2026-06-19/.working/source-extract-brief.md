---
title: "UX Source Extract — Product Brief (Qualitative / Experiential Layer)"
source: "_bmad-output/planning-artifacts/briefs/brief-patient_management_system-2026-06-18/brief.md"
extracted: 2026-06-19
purpose: "Capture brand, tone, positioning, user context, and UX implications from the brief for downstream UX design."
note: "Verbatim Korean quoted where load-bearing. Inferences explicitly marked [INFERENCE]."
---

# UX Source Extract — Product Brief

> Scope: this note pulls the QUALITATIVE / EXPERIENTIAL layer only. The brief is the strongest source for brand & tone; functional/data detail lives in PRD + schema docs.

---

## 1. Product framing & positioning

**What it is (verbatim):** "환자 관리 시스템(PMS)" — "외래 운영 관리 앱" / "운영 관리 앱". The brief is emphatic that it is **NOT** an off-the-shelf EMR install: the client's request was *not* "EMR 하나 깔아 달라" but "**흩어진 암묵적 워크플로우를, 사람이 바뀌어도 무너지지 않는 명시적·표준화된 운영 체계로 굳혀 달라**."

**Core problem solved:** A 수십 년 업력 지역 중소병원 (decades-old regional small/mid hospital) is in **세대교체** (generational handover). Outpatient operations ran on veterans' "**머릿속과 손버릇 — 암묵적 관성**" (heads and hand-habits — tacit inertia). As veterans leave and new staff arrive, 접수·처치·수납·예약 all start to fail. The product's mission is to move tacit knowledge into the system: "**사람 머릿속의 암묵지를 시스템 안의 명시지로 옮긴다**" (move 암묵지/tacit → 명시지/explicit).

**Positioning one-liner (synthesized):** An outpatient operations-management app that encodes a small/mid hospital's tacit veteran workflows into an explicit, role-based, system-guided pipeline so operations survive generational staff turnover.

**Scope framing:** Deliberately narrowed to **외래 (outpatient) only** (입원/inpatient deferred to a next phase), but "**그 안에서는 정석을 다 넣는다**" (within that scope, put in the full textbook/orthodox set). Boundary principle quoted: "**정석을 다 넣되, 외래라는 한 우물에서**."

**Meta-framing:** It is a freelancer-training assignment (과제), but the brief insists the real goal is demonstrating "**모호한 요청을 받아 ... 실제 병원의 결을 가진 시스템으로 구체화하는 능력**" (the ability to take a vague request and concretize it into a system with the texture/grain of a real hospital). The brief explicitly refuses to invent a market moat: "독보적 기술 우위'를 지어내지 않는다."

---

## 2. Target users & their context

The system serves two groups — **직원 (staff)** who run the workflow, and **환자 (patients)** who pass through it. But the brief names ONE design-center persona:

**THE central design persona — 신규 직원 (the new/junior employee):**
- Verbatim: "**아직 암묵지를 체득하지 못한 신규 직원**" — "모든 화면은 '이 사람이 선배 없이도 제대로 일할 수 있는가'를 기준으로 만들어진다."
- "**베테랑은 시스템이 없어도 일하지만, 신규 직원은 시스템이 안내해야 일한다.**"
- **UX implication (load-bearing):** Every screen is judged by "can this person do the job correctly WITHOUT a senior nearby." The system must *guide*, not just *capture*. Low prior knowledge → high need for step-by-step affordance, in-context guidance, and forgiving error recovery.

**Staff — desktop web, 5 roles:**
| Role | Context / environment | Needs (verbatim cues) | Success cue |
|---|---|---|---|
| 원무과 (front desk, 접수·수납) | Busy reception, waiting-room flow, billing | "순번·수가 코드·정산을 헷갈리지 않을 것" | 입사 첫 주에도 접수·정산 정확 |
| 의사 (doctor) | 진료실, time-pressured | "환자 이력과 검사 결과를 한눈에, 오더가 정확히 전달될 것" | 행정 아닌 진료에 집중, 오더 누락 없음 |
| 간호사 (nurse) | Treatment area, vitals + 처치 | "어떤 오더를 누가 수행할지 명확할 것" | 처치 중복·누락 0 |
| 방사선사 (radiographer) | Imaging room / equipment | "촬영 대기 목록과 장비 상태가 명확할 것" | 오더→촬영→판독 끊김 없음 |
| 관리자/운영진 (원장) | Admin; **실질적 구매 결정자** | "사람이 바뀌어도 병원이 굴러가는 체계, 운영 현황을 보는 눈" | 세대교체가 운영 리스크 아님 |

**Patient — mobile app (APK):**
- "전화 없이 예약, 내 기록을 안전하게 확인" → 편리하게 예약, "**내 정보는 나만 본다(RLS로 강제)**."

**Context signals relevant to UX density / speed / error tolerance:**
- **Speed/density:** Front desk and 진료실 are time-pressured, high-throughput environments. 의사 wants "한눈에" (at-a-glance) patient history + results → favors dense-but-scannable, summary-first layouts. [INFERENCE from "한눈에" + clinic context]
- **Error tolerance is LOW & safety-critical:** wrong 순번 → "환자를 두 번 부르거나 건너뛴다 → 대기실 혼선과 항의"; verbal orders → "처치를 중복하거나 누락한다 → 환자 안전 직결"; wrong codes → 정산 오류. These map to hard UX guardrails (confirmation, single-source pickers, clear "next action," explicit who-did-what).
- **Tech comfort:** Not stated explicitly. [INFERENCE] Mixed; design center is the *new* employee with no tacit knowledge → assume the UI cannot rely on insider know-how; affordances must be self-evident. Patients span general public on mobile → simple, low-friction flows.
- **Emotional state:** [INFERENCE] New staff = anxious/under-trained; patients = want reassurance their data is private and booking is easy; admin = wants to feel operational risk is contained.

---

## 3. The 7 pillars (7기둥) + per-pillar UX implications

The brief: "이를 일곱 기둥으로 구현한다. 각 기둥은 앞 절의 구체적 고통 하나에 정확히 대응한다."

1. **명시적 진료 파이프라인 (Explicit care pipeline).** States: 예약 → 접수 → 진행중 → 완료/취소. "화면은 늘 '지금 이 환자에게 다음에 할 일'을 보여 준다."
   - *UX:* A persistent, prominent "next action" affordance per patient/encounter; a state machine made visible (status badges, stepper/progress). The pipeline IS the navigation spine. → resolves 접수·대기 혼선.

2. **역할별 가이드 화면(6종) + RBAC.** "여섯 역할이 각자 자기 단계만 본다." Permissions toggled in admin page "코드 수정 없이." "자기 화면이 자기 일을 규정한다."
   - *UX:* 6 distinct role-scoped UIs; each shows only that role's stage. Admin needs a permission toggle UI (no code). Screens should *define the job* (guided), not present a generic menu. → resolves 역할 혼선·구두 의존.

3. **오더 → 수행 추적 (Order → fulfillment tracking).** "지시(의사) → 수행(약사·방사선사·간호사)" — "누가, 언제, 무엇을 수행했는지가 기록으로 남는다."
   - *UX:* Clear order lists with status; explicit actor/time stamping; visible "done by whom / when." Worklist UI for fulfillers (nurse/radiographer). → prevents 처치 중복·누락 (patient safety).

4. **단일 진실 마스터 데이터 (Single-source master data).** 수가·약품·진단코드 chosen from standard masters. "'베테랑만 아는 코드'가 사라지고."
   - *UX:* Pickers/searchable selectors from master tables instead of free-text; standardized inputs reduce error. → removes 수납·정산 오류, 코드 불일치.

5. **표준 기록 자동화 (Standard record automation).** Clinical record in **SOAP**; billing as Korean standard "**「진료비 계산서·영수증」**" and "**「세부산정내역서」**," auto-generated from data.
   - *UX:* SOAP-structured note entry; print/export of standard Korean billing documents that look official/правильно formatted. → resolves 기록 분실·추적 불가.

6. **멀티플랫폼 + 환자 포털 (Multi-platform + patient portal).** Staff = desktop web; patient = mobile app (APK), self-booking + own-history lookup.
   - *UX:* Two distinct surfaces — dense desktop tool for staff, simple mobile flow for patients. Patient self-service reduces 원무 phone load. → resolves 예약 혼선·원무 과부하.

7. **보안·신뢰 (Security & trust).** RLS (patient sees only own data, DB-enforced), 주민등록번호 encrypted (pgcrypto, Supabase Vault), audit log on all major actions. "보안이 직원의 주의력이 아니라 시스템에 의해 보장된다."
   - *UX:* Trust must be felt — privacy reassurance to patients ("내 정보는 나만 본다"); audit visibility for admin; sensitive fields (주민번호) handled with visible care (masking). → keeps sensitive data safe even with many new staff.

**Unifying thread (verbatim):** "**일곱 기둥은 모두 같은 일을 한다 — 사람 머릿속의 암묵지를 시스템 안의 명시지로 옮긴다.**" Result: not mere computerization but "**세대교체에도 무너지지 않고 신규 직원이 빠르게 정착하는 운영 체계.**"

---

## 4. Brand voice & tone

The brief does not state an explicit "brand voice" section, but tone is strongly implied by HOW it speaks and what it values. Capturing both.

**Stated/strongly-implied product personality:**
- **Guiding, not just recording.** Recurring verb: **안내한다 / 가이드** ("시스템이 다음 단계로 안내한다," "안내(가이드)만으로 핵심 플로우를 ... 완주"). The product's character is a *patient guide/coach* for the under-trained user.
- **Trustworthy / safe / clinical.** Built around 보안·신뢰, patient safety (환자 안전 직결), standards (SOAP, 한국 표준 진료비 문서). → tone should read as **credible, clinical, dependable.**
- **Efficient / precise.** Anti-error framing throughout (헷갈리지 않을 것, 누락 0, 한눈에). → **fast, unambiguous, no-fuss.**
- **Honest / humble.** The brief itself is candid about limits ("솔직한 한계," "만병통치가 아니다," "학습용 모사다"). "이 한계들을 숨기지 않는 것 자체가 ... 신뢰를 만드는 방식이다." → a voice that does **not over-promise**; plain and forthright. [INFERENCE that this honesty extends to microcopy — the brief models it but does not prescribe it for UI.]

**Microcopy tone (no verbatim spec given) — [INFERENCE grounded in the above]:**
- Imperative, action-first guidance copy ("다음 단계: ...") that tells the new employee what to do next.
- Calm, clear, reassuring error/confirmation copy given low error tolerance and safety stakes.
- Patient-facing copy: simple, reassuring, privacy-forward ("내 정보는 나만 본다").

**Feeling the product should evoke:** confidence and competence for the new employee ("선배 없이도 제대로"); reassurance/control for the admin (세대교체가 위기 아님); safety/privacy trust for the patient.

---

## 5. Differentiators & values → design values

**Differentiators (verbatim, 3):**
1. "**문제를 다르게 정의했다.**" — not "종이를 화원으로" computerization but encoding tacit→explicit operating system. "차별은 기능이 아니라 **문제를 보는 각도**에 있다."
2. "**단순화 대신 정석을 택했다.**" — SOAP, DB-based RBAC + RLS, 주민번호 encryption, order→fulfillment split, Korean standard billing docs, audit log. "'돌아가기만 하는' 데모가 아니라 *현실의 결을 가진* 시스템."
3. "**입력 폼이 아니라 워크플로우 가이드다.**" — "진료 상태머신이 '다음에 할 일'을 안내한다. **신규 사용자 친화성이 부가 기능이 아니라 설계 원리다.**"

**Design values that follow (derived, mostly explicit):**
- **Guidance-as-design-principle** (not bolt-on): new-user friendliness is foundational → the whole UX is a guided pipeline.
- **Orthodoxy / "정석" over simplification:** use real, standard clinical/billing structures even when heavier; the UI should feel like a *real hospital system*, "현실의 결."
- **Single source of truth:** standardized pickers over free-text everywhere it matters.
- **Make the implicit visible:** status, next-action, who-did-what, audit — surface what used to live in heads.
- **Honesty / no fake moat:** humility as a trust mechanism. [INFERENCE: design should not fake polish over function — substance first.]

---

## 6. Success signals / north-star (experiential)

**North-star (verbatim vision):** become the hospital's "**운영 기억(operating memory)**" — "사람이 몇 번 바뀌어도 병원은 첫날처럼 굴러간다. **세대교체가 더 이상 위기가 아니라 그저 또 한 번의 평범한 인수인계가 된다.**"

**What "good" looks like experientially (from success criteria):**
- New employee performs core tasks within first week WITHOUT a senior ("신규 직원이 선배 없이도 핵심 업무를 해내고") → onboarding time ↓.
- 처치 중복·누락 0; 수납 정산 오류 ↓; 더블부킹·노쇼 누락 0; 환자 본인 외 데이터 접근 0; 버스 팩터 > 1.
- **Assignment-level UX criterion (verbatim):** "**④ 사용자 친화: 신규 사용자가 안내(가이드)만으로 핵심 플로우를 처음부터 끝까지 완주한다.**" → the experiential acceptance bar for UX.

**Demo golden path (the integration UX spine, verbatim):**
"환자 앱 예약 → 원무 접수 → 의사 진료(SOAP)·처방·검사 오더 → 간호 활력징후·처치 수행 → 방사선사 촬영·판독 → 원무 수납(표준 진료비 문서 출력) → 관리자 권한 토글·감사로그 확인." — must run "끊김 없이" (seamlessly) end-to-end across 6 roles. This is the canonical cross-role flow the UX must make traversable.

---

## 7. Explicit UI/UX/aesthetic statements (verbatim)

The brief has NO visual/aesthetic spec (no colors, typography, layout language). The explicit UX-relevant statements are about *behavior and principle*, quoted verbatim:

- "화면은 늘 **'지금 이 환자에게 다음에 할 일'**을 보여 준다."
- "신규 직원이 절차를 외우지 않아도 **시스템이 다음 단계로 안내한다.**"
- "여섯 역할이 각자 **자기 단계만 본다.** ... **자기 화면이 자기 일을 규정한다.**"
- "화면이 데이터를 받기만 하는 게 아니라, 진료 상태머신이 **'다음에 할 일'을 안내한다. 신규 사용자 친화성이 부가 기능이 아니라 설계 원리다.**"
- "모든 화면은 **'이 사람이 선배 없이도 제대로 일할 수 있는가'를 기준으로 만들어진다.**"
- "**입력 폼이 아니라 워크플로우 가이드다.**"
- Platform split (verbatim): "직원은 **데스크톱 웹**에서, 환자는 **모바일 앱**에서 만나며" / "직원용 데스크톱 웹 + 환자용 모바일 앱(APK)."
- Patient privacy (verbatim): "**내 정보는 나만 본다(RLS로 강제).**"
- Output artifacts the UI must render (verbatim): SOAP 형식; 「진료비 계산서·영수증」; 「세부산정내역서」.

**Aesthetic direction:** NOT specified in brief — [GAP for UX to define]. Must be inferred/decided downstream (likely clinical, trustworthy, dense-but-scannable for staff desktop; simple/reassuring for patient mobile) — but the brief itself states no colors, type, or visual style.

---

## Quick reference — strongest signals for UX

- **Design center = 신규 직원** (new employee, no tacit knowledge). Litmus test for every screen.
- **Core character = guide/coach** ("다음에 할 일" everywhere). 워크플로우 가이드, not 입력 폼.
- **Tone = clinical, trustworthy, efficient, honest/humble.**
- **Two surfaces:** dense desktop (staff, 5 roles, at-a-glance) vs simple mobile (patient, reassuring, privacy-forward).
- **Hard guardrails** (low error tolerance, safety): next-action prompts, master-data pickers, who-did-what visibility, confirmations.
- **No aesthetic spec exists** in the brief — visual language is a downstream UX decision.
