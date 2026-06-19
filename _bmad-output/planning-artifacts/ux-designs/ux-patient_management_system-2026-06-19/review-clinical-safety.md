# Clinical-Safety + PII/Security Review — PMS UX Spine (DESIGN.md / EXPERIENCE.md + 4 mockups)

> Reviewer lens: adversarial. This system handles real patients and 주민등록번호. Where the spine is silent, I treat silence as a gap — because an implementer with no spec will improvise, and improvisation around allergies and RRN is how people get hurt and data leaks. Cited to file + line/section where possible.

## Overall verdict: **ADEQUATE (with one CRITICAL and several HIGH gaps that must be closed before build)**

The spine has genuinely strong instincts: allergy alert is a defined component with monitor-robust styling, RRN masks by default, reveal is audit-labeled, RBAC is 3-layered, audit is append-only, state-machine "only-allowed-transitions" is stated. But almost every patient-safety guarantee is asserted as a *principle* and demonstrated *once* in a mockup, with no spec for the failure modes that actually cause harm: allergy overflow, prescribing against a known allergen, order-loss visibility, identity confirmation, and several PII leak surfaces (printed RRN, error/realtime payloads, deep links). The mockups even contain a live contradiction that demonstrates the exact harm the system is supposed to prevent. "Decoration in one mock" vs "systematic pattern" is the recurring weakness.

---

## 1. Patient-safety salience (누락 0)

**[CRITICAL] The mockups prescribe a drug the same patient is flagged allergic to — and the spine has no allergy↔prescription cross-check.**
- 김영희 in `key-encounter-hub.html` carries **아스피린 알레르기** (line 631, alert chip; line 746, profile tag).
- 김영희 in `key-patient-app.html` is shown a completed prescription for **아스피린 100mg** (lines 540–546), with cheerful plain-language dosing ("저녁 식사 후 한 알 드세요").
- The only drug-safety check the spine names is **동일성분 중복 처방 경고 (FR-052)** (EXPERIENCE.md Component Patterns / 임상 안전 패턴 line 168). There is **no allergy-vs-order check** anywhere in DESIGN.md or EXPERIENCE.md. The "와파린 병용 경고" is hand-placed text in one alert chip (encounter-hub line 632) — it is **decoration in one mock, not a systematic pattern**: nothing in the order panel spec says interactions/allergies are evaluated when an order is added.
- *Fix:* Add an explicit clinical-safety component to EXPERIENCE.md order-panel + 임상 안전 패턴: **on every order add, evaluate against (a) recorded allergies, (b) current meds for interactions** and surface a hard-stop/override-with-reason dialog. Define it as a spine pattern, not a per-mock chip. Fix the demo data so the golden-path patient is not prescribed her own allergen — right now the flagship artifact *demonstrates the accident*.

**[HIGH] Allergy alert has no defined overflow/truncation behavior — many allergies can hide one.**
- `allergy-alert` (DESIGN.md line 124–131) and 임상 안전 패턴 ("누락 0 · can't-miss", EXPERIENCE.md 167) assert always-visible, but the mockup row is a single horizontal flex of chips with a **"상세 · 변경 이력" more-link** (encounter-hub line 634). With 6–10 allergies the row wraps or pushes content; the "can't-miss" guarantee silently degrades to "the first few you can fit." There is no spec for "+N more," no max, no guarantee that the *most severe* allergen is never the one collapsed.
- *Fix:* Specify allergy overflow explicitly: never truncate to a "more" link that hides an allergen; either wrap-all (banner grows) or show a count chip that is itself danger-styled and expands inline. State that severity-ranked items render first and that collapsing an allergen is forbidden.

**[HIGH] Order → 수행 tracking can lose an order silently; no "unperformed/overdue" surfacing in the spine.**
- The order panel shows a trace line ("오더→수행: 지시자·시각·수행 상태", DESIGN.md 277; encounter-hub lines 911, 920, 929 show "약국 대기"). But the spine has **no view that answers "which of today's orders are still un-performed?"** from the safety side. Worklists are role-scoped (간호/방사선 see their own), and the doctor's panel shows status per item — but nothing flags an order that was placed and never picked up. An order that routes to a worklist nobody worked is invisible until someone notices.
- *Fix:* Add an "outstanding orders / overdue 수행" indicator (encounter hub + worklists) with an age/threshold. "누락 0" needs a *detector*, not just per-item status text.

**[MEDIUM] "완료 irreversible" (FR-093 re-do prevention) is stated for the encounter transition but not for individual order 수행.**
- The encounter action bar says "완료 시 … 되돌릴 수 없음" (encounter-hub line 977) — good. But FR-093 is about **이미 수행된 오더 재수행 차단**. EXPERIENCE.md 임상 안전 패턴 line 169 says performed orders' actions go disabled, with "mutation 중 버튼 disable이 1차선, 상태머신이 최종선." The *mockups never show a performed/locked order* — every order item still shows an active "×" 삭제 button (encounter-hub lines 905, 914, 923) even though FR-052/093 imply executed items shouldn't be freely deletable by the ordering doctor after performance.
- *Fix:* Show the performed/locked order state in the order-panel spec and a mock; clarify that delete is gated once an order is 수행완료 (and that deletion of a performed order is itself an audited/blocked action).

---

## 2. Wrong-patient risk

**[HIGH] No identity confirmation before high-risk writes; banner identity is present but passive.**
- Patient banner is always visible (good — encounter-hub 622–670, billing 487–520). But the spine has **no identity-confirmation step** before completing an encounter, issuing a prescription, or taking payment. The action bar's "진료 완료 → 수납" (encounter-hub 980) and billing "결제" (billing 636) fire with no "you are acting on 김영희, chart 00123 — confirm?" The new-employee persona is precisely the user who finishes documentation in the wrong open tab.
- *Fix:* For high-risk irreversible actions (encounter 완료, 처방 발행, 수납, 환자 삭제), require an identity-bearing confirm (name + chart no in the confirm dialog). Cheap, and it directly attacks wrong-patient harm.

**[HIGH] Multiple-encounter / stale-tab safety is undefined — "two encounters open" is not addressed.**
- The encounter URL is `/encounter/{date}/{chart_no}` (EXPERIENCE.md IA line 59; encounter-hub URL line 573). Nothing stops a clinician opening two encounters in two tabs; autosave ("자동 저장됨", encounter-hub 820) writes silently to whichever tab last fired. The 409 handling ("다른 단말에서 상태 변경됨", encounter-hub 987) covers *transition* conflicts but **not silent autosave into a stale-but-still-open SOAP for the wrong patient.**
- *Fix:* Spec the stale-tab/secondary-encounter case: a tab that has lost the "active encounter" lock must show a blocking banner and refuse autosave; consider single-active-encounter enforcement per clinician. Add to State Patterns.

**[MEDIUM] Ctrl-K global search → wrong-patient navigation has no guardrail.**
- Ctrl K searches name·차트번호·연락처 (EXPERIENCE.md 60). Two patients named 김영희, or a mistyped chart number, lands you on the wrong banner with no disambiguation cue beyond what's in the banner. Acceptable, but combined with no identity-confirm (above) it compounds.
- *Fix:* Search results should show enough disambiguators (DOB, masked RRN tail, last visit) and the destination action should re-state identity.

---

## 3. State-machine correctness

**[MEDIUM] 409 / 403 / 422 are specified with user-facing behavior — this is a genuine strength.**
- 422 inline+focus, 403 disabled+lock+tooltip, 409 toast+refresh with local-change preservation are all defined (EXPERIENCE.md State Patterns 120–127; 상태머신 반영 179–183) and demonstrated (encounter-hub 1000–1037). Good. No change needed to the mapping itself.

**[HIGH] Race condition on concurrent performance/settlement is under-specified beyond "buttons disable."**
- "mutation 중 버튼 disable" (EXPERIENCE.md 129) is the *first* line and only the local one. Two nurses on two PCs opening the same 처치오더 both see it actionable until one commits; the loser gets a 409. That's the intended path — but the spine never says the **worklist must reflect the just-performed state within the ≤5s realtime window**, and "optimistic 업데이트는 안전한 곳에만" (129) leaves "safe" undefined. Under realtime lag, the second nurse can act on a stale "un-performed" row.
- *Fix:* State that performance/settlement actions are **non-optimistic and re-validate server-side on submit** (already implied) AND that the row is locked on realtime receipt; define behavior when realtime is stale (see §next). Tie this explicitly to FR-093.

**[HIGH] Stale-realtime + critical action: spine *recommends* refresh but doesn't *enforce* it.**
- "호출 등 중요 동작 전 새로고침 권장" / "자동 덮어쓰기 X" (EXPERIENCE.md 124). "권장" (recommended) is not a guard. A new employee will call/perform off stale data.
- *Fix:* When the realtime channel is stale, **disable** critical mutation buttons (call, perform, complete, settle) until reconnect/refresh, not merely advise.

---

## 4. PII handling

**[CRITICAL] Printed 영수증 shows masked RRN — but the legal-document path has no reveal/audit model, and masking on a *printed* statutory form is likely wrong either way.**
- `key-billing.html` legal preview prints **주민등록번호 710314-2****** (line 704). Two problems: (a) if the statutory form legitimately requires the full RRN, then printing it is an **un-audited reveal** outside the banner's "표시 + 감사기록" gate — the entire decrypt/audit discipline (EXPERIENCE.md PII 패턴 174; architecture extract §5) is bypassed by the print path; (b) if it stays masked, the document may be non-conformant. Either way the spine never addresses **PII on printed output**, which is a classic leak vector (paper left on a desk, PDF saved to a shared drive — "PDF 저장" billing line 667).
- *Fix:* Decide and spec the print policy explicitly: which fields appear on each statutory form, whether full RRN is required, and that **rendering full RRN into a document is itself an audited reveal event** gated by permission. Add a watermark/limited-fields option and warn on "PDF 저장" destination.

**[HIGH] Phone reveal button has NO audit label, unlike the RRN reveal — inconsistent PII discipline.**
- RRN reveal shows "표시 + 감사기록" (encounter-hub 654, billing 505). The **연락처 reveal button right next to it has no "감사기록" label** (encounter-hub 657, billing 508). Phone number is PII; either its reveal is audited (then label it, for deterrence per §6) or it isn't (then it's an unlogged PII reveal). The spine's PII pattern (174) names only 주민번호 for the audit-on-reveal rule and says "연락처 등 PII도 부분 마스킹+표시" (110) without an audit requirement.
- *Fix:* Treat contact/address/보험/보호자 reveals as audited too, and label them consistently. State the rule once in EXPERIENCE.md PII 패턴, not per-field.

**[HIGH] No spec forbids RRN/PII in URLs, deep links, realtime payloads, or PDF filenames — only in logs/toasts/errors.**
- The spine repeatedly forbids raw RRN in "로그·토스트·오류 envelope" (EXPERIENCE.md 78, 174; architecture extract §5). It is **silent on**: query strings / deep-link params, the `postgres_changes` realtime payloads (which stream encounter/order rows to subscribed clients — does the streamed row include `resident_no_enc`/decrypted fields? RLS scopes *rows* not *columns*), TanStack Query cache contents in memory/devtools, and generated PDF/print filenames.
- *Fix:* Add an explicit rule: PII (esp. RRN) never travels in URLs, never in realtime broadcast columns (select-list must exclude encrypted/sensitive cols from subscriptions), and document filenames use chart_no + date only. Confirm RLS column-level exclusion for sensitive fields on the Supabase-direct read path.

**[MEDIUM] RRN reveal is gated by permission + audit, masked by default on both list and detail — good, but the *default-masked-on-lists* claim is unverified.**
- The two surfaces with RRN both mask by default (banner). But no mockup shows a *patient list / search results* surface, and the spine doesn't restate that RRN is masked in TanStack Table grids and Ctrl-K results. "마스킹 by DEFAULT on every surface" is asserted but only demonstrated on detail banners.
- *Fix:* Explicitly state masking applies to all list/grid/search renders, and that lists never carry a per-row reveal (reveal only in detail, always audited).

---

## 4b. RLS / patient app

**[MEDIUM] Patient-app RLS is asserted and surfaced as a trust note — good — but cross-patient leak vectors aren't enumerated.**
- Trust note "본인 정보만 … 다른 사람은 볼 수 없어요" (patient-app 504) + RLS owner policy (architecture §4) is the right posture. But the patient app has no search; the only deep-surface is the visit card expand. The risk is **server-side**: if the patient portal's read path ever queries by a client-supplied id rather than `auth.uid()`, RLS is the only backstop. The spine correctly says DB is authority — but there's no UI-side statement that the portal must never accept a patient/encounter id from the client for record fetch.
- *Fix:* State that patient-portal reads are always scoped by session uid (no client-supplied patient_id), so a tampered request can't even be *formed*. Belt-and-suspenders with RLS.

**[LOW] Patient app lab results use friendly flags (정상/주의) — fine — but "주의 142/90" with no actionable guidance beyond "약 꾸준히" could under-warn a true emergency.**
- Plain-language reassurance (patient-app 555) is good UX, but the spine should ensure genuinely critical values (e.g., hypertensive crisis) aren't softened into "조금 높은 편이에요."
- *Fix:* Define a critical-value tier that escalates copy ("의료진에 연락하세요") rather than reassures.

---

## 5. Destructive / sensitive actions

**[HIGH] RBAC matrix applies sensitive permissions IMMEDIATELY with no confirmation — a misclick silently grants 주민번호 표시 / 감사 로그 조회.**
- "즉시 적용(저장 버튼 없음) + 감사 기록" (DESIGN.md 280; EXPERIENCE.md 112; rbac mock 418–422, 670). Audit-after-the-fact is good for forensics but **bad for prevention**: one stray click in the 주민번호 표시 / 환자 삭제 / 권한 관리 / 감사 로그 조회 row instantly grants a sensitive capability to a whole role. The "민감" pill (rbac 481, 488, 617, 639, 655) marks the row but does **not gate the toggle**.
- *Fix:* Sensitive permissions must require a confirm step (and ideally re-auth) before applying — "민감" marking should trigger a confirmation dialog naming the permission and affected role. Immediate-apply is fine for non-sensitive cells.

**[MEDIUM] 환자 삭제 / 수가 조정 exist as permissions but have no confirmation/audit UX defined.**
- The matrix lists 환자 삭제 and 수가 조정 as sensitive (rbac 489, 617) and the schema notes soft-delete (FR-203). But no screen or spine section defines the **confirmation + reason-capture + audit** flow for actually deleting a patient or adjusting a fee. These are exactly the destructive actions that need a typed-confirm + reason.
- *Fix:* Spec destructive-action pattern (confirm + reason + audit snapshot) for 환자 삭제 (soft) and 수가 조정; reference the append-only audit before/after snapshot.

**[LOW] 관리자 column is locked all-on (🔒) — reasonable — but means an admin can never be denied 감사 로그 조회, removing separation-of-duties.**
- rbac mock fixes admin = all permissions, uneditable (rbac 454, 671). A single super-admin who can both grant permissions and read/needs-no-trace... the audit is append-only which mitigates, but there's no notion that even admin RRN-reveal/audit-read is itself logged.
- *Fix:* Confirm that admin's own sensitive reveals/reads are audited too (admins are not exempt from the audit trail).

---

## 6. Audit completeness

**[MEDIUM] Append-only audit is reflected in UI and the reveal control advertises logging (good deterrence) — but deterrence is inconsistent and incomplete.**
- Strengths: append-only read-only diff viewer asserted (EXPERIENCE.md 176; architecture §4 REVOKE update/delete even for service_role); RBAC footer "누가·언제·무엇을 … 감사 로그에 자동 기록" (rbac 670); RRN reveal carries visible "감사기록" (encounter-hub 654). This visible-logging-as-deterrence is a real strength.
- Gaps: the deterrence label is **only on RRN reveal**, not on phone reveal (§4), not on print/PDF (§4 CRITICAL), not on the 완료/수납/삭제 actions. Users can't tell those are logged.
- *Fix:* Make "this action is recorded" a consistent affordance on every sensitive/destructive action, not just RRN. Confirm audit captures: every reveal (RRN + other PII), every print/PDF export, every state transition, every RBAC change, every destructive action — and surface a per-patient "access history" the patient or admin can see.

---

## Severity counts

| Severity | Count | Findings |
|---|---|---|
| **CRITICAL** | 2 | §1 allergy↔prescription (no cross-check + mock prescribes patient's own allergen); §4 printed-RRN unaudited reveal / print PII policy missing |
| **HIGH** | 8 | §1 allergy overflow; §1 order-loss detector; §2 no identity-confirm; §2 stale-tab/multi-encounter; §3 concurrent perform/settle race; §3 stale-realtime not enforced; §4 phone reveal unaudited; §4 PII in URLs/realtime/PDF unspecified; §5 sensitive-RBAC immediate-apply no confirm |
| **MEDIUM** | 8 | §1 order re-do lock not shown; §2 Ctrl-K disambiguation; §3 409/422/403 (strength, no change); §4 list/grid masking unverified; §4b portal client-id scoping; §5 delete/fee-adjust flow; §5 admin self-audit; §6 deterrence inconsistency |
| **LOW** | 3 | §4b critical-value copy; §5 admin all-on separation-of-duties; (counted within above) |

*(HIGH count includes the two §4 sub-items as one entry each; total distinct findings ~20.)*

## Must-fix before build (top priority)
1. **Allergy↔order safety check as a spine pattern** + fix the demo that prescribes the patient's own allergen. (CRITICAL)
2. **Print/PDF PII policy** — define fields per statutory form; treat full-RRN rendering as an audited, permission-gated reveal. (CRITICAL)
3. **Confirmation gate on sensitive RBAC toggles** and on destructive actions (delete/fee-adjust/complete/settle), each with identity restated. (HIGH)
4. **Allergy overflow spec** — never hide an allergen behind a "more" link. (HIGH)
5. **PII boundary spec** — no RRN/PII in URLs, realtime payload columns, or document filenames; audit every PII reveal, not just RRN. (HIGH)

---

*Report path: `_bmad-output/planning-artifacts/ux-designs/ux-patient_management_system-2026-06-19/review-clinical-safety.md`*
