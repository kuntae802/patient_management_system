# Spine Pair Review — patient_management_system

> RUBRIC WALKER pass over the final spine pair (DESIGN.md + EXPERIENCE.md) as a downstream contract.
> Question: can a consumer (architecture, story-dev) source-extract cleanly, every reference resolving, every load-bearing decision committed?

## Overall verdict

A genuinely strong pair: flow coverage, component pairing, state coverage, and inheritance discipline are near-airtight, and the spine/source/decision-log trace is exemplary. A consumer can source-extract the clinical surface cleanly — every `{components.*}` ref in EXPERIENCE.md resolves to a defined DESIGN.md token, every UJ has a named-protagonist flow, every IA surface has its state treatments. Two issues block a *clean* extract: (1) EXPERIENCE.md defers contrast numbers to DESIGN.md but DESIGN.md states **no** contrast/WCAG target anywhere — a dangling promise on load-bearing color combos; (2) mockup inline-linking is one aggregate nickname reference instead of per-section links to the six filenames, so visual-reference resolution is weak. Everything else is polish.

## 1. Flow coverage — strong

Checked: every UJ / named workflow in the PRD + brief extracts (UJ-1 golden path; 예약/접수/진료·오더/수행/수납/결과-확인 sub-workflows; order/billing/booking lifecycles) against EXPERIENCE.md Key Flows. All present with named protagonists matching PRD casting (정해린 원무, 김도현 과장 의사, 이수진 환자, + 한지우 간호·오민재 방사선·최원장 in Golden Path), numbered steps, explicit **Climax** beats, and failure paths where applicable.

### Findings
- **low** Flow A (정해린) and Flow B (김도현) carry failure paths; Flow C (이수진, patient app) has none. A patient-side failure (슬롯 선점 race → 409 on 예약 확정, or RLS/load failure on 내 기록) would round out the trio and is the one place a new-consumer flow lacks a documented error branch (EXPERIENCE.md:214–222). *Fix:* add a one-line failure to Flow C — e.g., "슬롯 동시 선점 → 409 + '방금 마감된 시간입니다, 다시 선택' inline."
- **low** Nurse (한지우) and radiographer (오민재) only appear *inside* the Golden Path summary, never as their own numbered flow with a climax, though their worklist behaviors are load-bearing (FR-090~103, 처치 중복·누락 0 success metric). This is defensible (decision-log marks 워크리스트 as spine-only/pattern-inherited), but a consumer building the nurse worklist has a flow narrative only by inference (EXPERIENCE.md:224–226). *Fix:* acceptable as-is given the spine-only call; if expanded, one short Flow D (한지우, 처치 수행→재수행 차단 climax) would close it.

## 2. Token completeness — adequate

Checked: every frontmatter token + every `{path.to.token}` in both files' prose. All `{colors.*}` / `{rounded.*}` / `{spacing.*}` refs in DESIGN.md resolve to frontmatter. All 11 distinct `{components.*}` refs in EXPERIENCE.md resolve to DESIGN.md `components` entries. Every color token carries a hex. `{date}`, `{chart_no}`, `{시각}`, `{path.to.token}` are URL-template / doc-syntax literals, not broken refs (correctly not tokens).

### Findings
- **high** Contrast targets are **absent from the load-bearing color layer.** EXPERIENCE.md Accessibility Floor explicitly punts ("대비 수치 등 시각값은 `DESIGN.md`(Colors)", line 143; "수치는 DESIGN.md", line 149) but DESIGN.md states no WCAG level and no ratio anywhere — `grep wcag|대비|contrast|AA|4.5|3:1` returns only the elevation/monitor rationale. The reference example (`experience-example-shadcn.md`) commits "WCAG 2.2 AA … brand overrides verified to maintain ratios"; here the deferral resolves to nothing. This matters most for non-inherited brand colors on white: amber `#BC7E12` (`status-received`) needed a darker ink `#8A5D09` precisely *because* of white-background legibility — so the team already knows these combos are marginal, but no target/ratio is committed for a consumer or QA to verify against. *Fix:* add one line to DESIGN.md Colors: "텍스트/상태 라벨은 배경 대비 WCAG 2.2 AA(본문 4.5:1, 큰 텍스트/UI 3:1); 검증 조합 = status-received-ink·text-muted·primary on surface/background." 
- **medium** `soap-ledger.badge-colors` hardcodes hexes that are already defined tokens: `'S=#4F46C7 · O=#0E7C8E · A=#8A5D09 · P=#2C8466'` (DESIGN.md:137, restated in prose 276) = `status-inprogress` / `primary` / `status-received-ink` / `status-done`. A consumer flattening via the resolver gets literals here instead of token refs, so a later token edit silently desyncs the SOAP badges. *Fix:* `'S={colors.status-inprogress} · O={colors.primary} · A={colors.status-received-ink} · P={colors.status-done}'`.
- **low** `danger` and `status-cancelled` share hex `#C2433B` by deliberate design (documented twice), so they will collide in any hex→token reverse lookup. Intentional and well-noted (DESIGN.md:30, 207); flagged only so a consumer dedup script doesn't treat it as an error. *Fix:* none needed; the inline note already covers it.

## 3. Component coverage — strong

Checked: every component named anywhere in either file for a DESIGN.md.Components row (visual) AND an EXPERIENCE.md.Component Patterns row (behavioral). All 11 clinical components are paired both ways with real multi-clause rules: `waiting-list-row`, `status-badge`, `soap-ledger`, `diagnosis-block`, `order-panel`, `patient-banner`, `allergy-alert`, `fee-table`, `slot-block`, `permission-cell`, `patient-app`. No one-word rows.

### Findings
- **medium** `button-ghost` is defined in DESIGN.md frontmatter + prose (visual: surface/border/hover, `.key` variant) and is load-bearing behaviorally — it's the **다음-액션 행 버튼**, the first-class next-action affordance — yet has **no EXPERIENCE.md Component Patterns row.** Its behavior is only mentioned in passing inside the `waiting-list` row ("다음-액션 ghost 버튼", EXPERIENCE.md:106). A consumer building the next-action button (the product's #1 pattern) has visual spec but no committed behavioral row (disabled-during-mutation, which states get 1 vs 2 buttons, allowed-transition gating). *Fix:* add a `next-action button (다음-액션)` row to Component Patterns, or fold the behavioral rules explicitly into one place. `button-primary` is similarly behavior-light but lower-stakes (single primary per screen is stated in DESIGN).
- **low** Component names are not identical across the two files for three entries (see Mechanical notes); the `{components.*}` token ref in each EXPERIENCE row bridges the gap so resolution still succeeds, but a name-match script flags them.

## 4. State coverage — strong

Checked: every IA surface walked against the expected state set (empty, cold-load, focus, error/validation, offline/stale, permission-denied). EXPERIENCE.md State Patterns covers 로딩(skeleton, no-spinner), 빈 상태(+single next-action), 실시간 끊김(stale), 검증 422(field-inline + focus move), 권한 거부 403(hidden nav + disabled+tooltip), 잘못된 전이 409(toast+refresh). HTTP mapping committed (409/403/422). Optimistic-update policy scoped to safe surfaces. RRN reveal, audit, RLS scoping all stated.

### Findings
- **low** Focus/writing state is specified richly for the SOAP ledger (좌측 3px teal + tint) but a generic field-focus state (the shadcn `ring` token applies) is only implied via "포커스 링 항상 보이게" in Accessibility Floor. Adequate — it's inherited from shadcn — but a consumer gets the SOAP-specific focus committed and the generic one only by inheritance reference. *Fix:* none required; inheritance is correctly stated.
- **low** Empty-state is given one concrete example (대기판) and a general rule. Surfaces flagged spine-only (워크리스트·마스터 CRUD·대시보드·환자검색) inherit the empty pattern but have no per-surface copy. Explicitly accepted in Open Items (EXPERIENCE.md:234). *Fix:* acceptable; tracked.

## 5. Visual reference coverage — thin

Checked: 6 files in `mockups/` (key-waiting-board, key-encounter-hub, key-patient-app, key-billing, key-appointment-calendar, key-rbac-matrix) against inline links in the spines. The reference pattern (`design-example`/`experience-example`) links each mockup inline at the relevant section and names what it illustrates ("→ Composition reference: `mockups/today.html` …").

### Findings
- **high** Mockup linking is **one aggregate reference by nickname, not per-section by filename.** EXPERIENCE.md has a single line in IA (line 69): "구성 레퍼런스: `mockups/`(대기판·진료허브·환자앱·수납·예약캘린더·RBAC매트릭스)." It names six nicknames but **zero filenames**, and is not placed at each relevant section (e.g., the `slot-grid` row doesn't link `mockups/key-appointment-calendar.html`, the `billing` row doesn't link `key-billing.html`). DESIGN.md has **no mockup links at all** — only prose mentions of "목업" (measured values, line 67/258). A consumer can't deterministically map a component to its illustrating file. *Fix:* on each EXPERIENCE Component Patterns row (or section), append the filename, e.g. "→ `mockups/key-appointment-calendar.html` (슬롯 그리드·더블부킹·휴진 빗금)"; add the same to DESIGN.md Components rows for the visual-spec mapping.
- **low** "충돌 시 이 spine이 우선" (spines-win-on-conflict) is stated exactly once (EXPERIENCE.md:69) — correct per spec — but it rides on the same aggregate line, so if that line is restructured the precedence rule could be lost. *Fix:* keep the precedence sentence as a standalone clause when adding per-section links.
- No orphan mockups: all six map to a documented surface/component. No unspecific refs beyond the nickname-only issue above.

## 6. Bloat & overspecification — strong

Verdict strong. Both files inherit-and-delta cleanly; no source restatement of FR text, no prose where a table serves (IA, Voice, Component Patterns, States, Responsive all tabular). Pixel values appear only where they ARE the decision and aren't covered by a token (pane widths, 132px SOAP min-height, 52px topbar) — and those are promoted to `spacing` tokens. EXPERIENCE.md prose stays behavioral; editorial voice is confined to Voice & Tone Do/Don't where it belongs.

### Findings
- **low** The v2→v4 elevation lesson is told in both DESIGN.md (Elevation & Depth, lines 252) and EXPERIENCE.md (Inspiration & Anti-patterns, 162) plus the decision-log. The DESIGN.md telling is load-bearing (it justifies the KEY RULE); the EXPERIENCE.md repeat is near-duplicate and points back to DESIGN anyway. Minor. *Fix:* the EXPERIENCE.md mention can shrink to its one-line cross-ref ("상세는 DESIGN.md") and drop the restated narrative.

## 7. Inheritance discipline — strong

Verdict strong. Frontmatter `sources:` is identical across both files (4 entries, `{planning_artifacts}`/`{project-root}` template paths matching the decision-log's confirmed sources). UJ-1 name verbatim from PRD; protagonist casting matches PRD "Journey name" column exactly. Glossary terms (`encounter=내원/진료`, `order=오더`, `fee_item=수가항목`) cited identically to the architecture extract; English-identifier / Korean-copy-layer rule consistent across spines and sources. Every EXPERIENCE.md token ref resolves to a DESIGN.md token by name.

### Findings
- **low** RRN mask sample value drifted from the decision-log: decision-log uses `900101-1******` (PII section), both spines use `710314-2******`. Both are valid masks and the spines agree with each other, so the *contract* is consistent; only the decision-log lineage shows the older sample. No downstream impact. *Fix:* none required (spines are the contract and are self-consistent); optionally align the decision-log sample.

## 8. Shape fit — strong

Verdict strong. DESIGN.md body sections are in canonical order (Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts); frontmatter has all required keys (name, description, colors, typography, rounded, spacing, components). EXPERIENCE.md has all required defaults (Foundation, IA, Voice & Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flows) plus correctly-triggered sections (Responsive & Platform — triggered by the Windows-first/1366×768 constraint; Inspiration & Anti-patterns). Invented sections (임상 안전 패턴, PII·감사 패턴, 상태머신 반영, Open Items) earn their place — each carries domain-load (FR-052/093, RLS, state-machine exposure rule, deferred-decision tracking) not covered by a default section.

### Findings
- None material. The three invented domain sections are the right call for a clinical/RBAC product and would be a real loss if folded into generic sections.

## Mechanical notes

**Name inconsistencies (token ref bridges resolution, but name-match fails):**
- `slot-block` (DESIGN.md frontmatter + prose) vs **`slot-grid`** (EXPERIENCE.md row title). Row references `{components.slot-block}` so it resolves; titles differ.
- `waiting-list-row` (DESIGN.md component) vs **`waiting-list`** (EXPERIENCE.md row title) vs `waiting-board` (DESIGN.md spacing comment). Token ref `{components.waiting-list-row}` resolves.
- `status-badge` (DESIGN.md component) vs **`status system (A3)`** (EXPERIENCE.md row title). Resolves via `{components.status-badge}`.
- `soap-ledger` (DESIGN.md) vs **`encounter hub`** (EXPERIENCE.md row, which bundles soap-ledger + diagnosis-block + patient-banner). Reasonable composition, but no 1:1 row for soap-ledger by name in EXPERIENCE — its behavior lives inside the encounter-hub row.
- *Suggested fix for all:* align EXPERIENCE row titles to the DESIGN component name, or add the component name in parentheses, so a name-keyed extractor and a token-keyed extractor agree.

**Broken / dangling cross-refs:**
- EXPERIENCE.md → DESIGN.md contrast deferral resolves to nothing (Finding 2-high).
- No mockup filename links in either spine (Finding 5-high).
- `soap-ledger.badge-colors` literal hexes bypass the token resolver (Finding 2-medium).

**Frontmatter completeness:**
- DESIGN.md: complete — all spec keys present, every color has hex, component tokens use `{path}` refs (except the badge-colors literals noted). `status: final` present.
- EXPERIENCE.md: complete — `name`/`status: final`/`sources`/`updated` present; matches DESIGN.md sources block.
- Both: `sources:` use `{planning_artifacts}`/`{project-root}` templated paths consistent with the decision-log; these resolve at the project level (consumer must expand the template — standard for this skill).

**Finding counts by severity:** critical 0 · high 2 · medium 2 · low 9
