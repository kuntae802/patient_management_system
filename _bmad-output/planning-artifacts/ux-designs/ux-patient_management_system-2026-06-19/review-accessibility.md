# Accessibility Review (Adversarial) — patient_management_system UX Spine Pair

> Reviewer lens: where this design fails real users with disabilities or on poor hardware.
> Scope: `DESIGN.md`, `EXPERIENCE.md`, `.decision-log.md`, and the 6 rendered mockups in `mockups/`.
> Voice: skeptical, default-to-flagging. Contrast ratios below were computed from the actual mockup hex values (sRGB, WCAG 2.x formula).

## Overall verdict: **THIN**

The team did real, above-average accessibility *thinking* on exactly one axis — the "no-meaning-by-color/shadow-alone" redundant encoding (color + glyph + weight + pattern), and it largely holds. Credit where due: A3 status, slot-grid (fill+border+pattern), RBAC (fill+✓), allergy alert (fill+border+bold+icon), and patient-app slots are genuinely robust to colorblindness and cheap monitors.

But "color isn't the only encoding" is roughly one of WCAG's ~50 success criteria, and the spine treats it as if it were the whole job. The moment you look past it, the floor drops out:

- **No screen-reader / semantics layer exists at all** — zero ARIA roles, labels, live regions, or `<label>` associations anywhere in the spine or mockups. For a clinical system handling RRN reveals, 409 toasts, and a 22×5 permission matrix, this is the single biggest gap.
- **The mockups are accessibility-hostile as built**: icon-only buttons with no accessible name, interactive controls built from `<span>`/`<div>` (not focusable, not operable by keyboard), checkboxes that are `<span class="cbx">`, slots that are `<div>`.
- **Concrete contrast failures** in load-bearing text: placeholders, disabled text, raw amber status, and several tinted chips fall below AA.
- **"Keyboard-first" is asserted but never specified** — no tab order, no focus-visible spec, no roving-tabindex plan for the grids/matrix/ledger.
- **Reduced-motion, text-scaling floor, and form-error/AT association are entirely unaddressed**, and `[OPEN] 모션` is explicitly punted.

The spine's own `Accessibility Floor` section (EXPERIENCE.md L141–149) is five bullets, four of which are the color/shadow point restated. That is the tell: accessibility here is a slogan ("음영 비의존"), not a coverage plan. Below, grouped and severity-rated by downstream impact.

---

## 1. Color-only / shadow-only meaning

**Verdict: this is the design's strongest area and it mostly holds — but with real holes.**

- **[low]** A3 status badges, slot-grid, RBAC cells, allergy alert, pay-chips, KPI chips, 급여/비급여 — all verified to carry a redundant glyph/shape/pattern/label in addition to color. (`key-waiting-board.html` L286–294, `key-appointment-calendar.html` L302–361, `key-rbac-matrix.html` L312–327, `key-encounter-hub.html` L239–251.) Good.

- **[medium]** **KPI strip relies on color + position, not glyph** (`key-waiting-board.html` L233–243, L467–473). Each KPI chip is `<dot> <label> <number>` — the dot is a bare colored circle with **no glyph** (unlike the A3 badges which add ○●◐✓✕). The label text ("접수", "진행중") carries the meaning, so it doesn't *fail* outright, but the dot is decorative-only color here while the same dot shape elsewhere is load-bearing. Inconsistent: a colorblind user learns "dot = glyph+color" from the table, then meets a glyph-less dot in the KPI strip. *Fix:* add the same ○●◐✓✕ glyph to KPI dots, or drop the dot and lean on the label.

- **[medium]** **Vitals "flag" state is color-only** (`key-encounter-hub.html` L286 `.v-val.flag` → amber-ink text; applied to 혈압 128/82 at L689). An abnormal vital is signaled purely by text color (amber-ink) plus a same-colored sparkline stroke. No icon, no "↑/주의" label, no asterisk. This is a *clinical* signal on a doctor's primary screen — exactly the place color-only fails a colorblind clinician or a washed-out monitor. *Fix:* add a glyph/label ("주의" / "↑") to flagged vitals; do not let abnormality ride on text color alone.

- **[medium]** **SOAP "writing/focus" state is encoded as a left teal bar + tint** (`key-encounter-hub.html` L387–389), which is monitor-robust — but the **placeholder vs filled distinction is color-only** (`.soap-br.placeholder` just sets `color: text-muted`, L391). A user who can't perceive the muted-vs-primary text difference can't tell an empty SOAP section from a filled one. *Fix:* mark empty sections with a glyph/label (e.g., "비어 있음" tag), not just lighter text.

- **[low]** **Patient-app date chip "휴진" uses opacity .45 + small "휴진" tag** (`key-patient-app.html` L167–168, L397–399). The tag rescues it, but `opacity:.45` as the primary differentiator is a faint signal; fine because the label exists.

- **[low]** Sparkline trend lines are `aria-hidden="true"` (good — they're decorative), but they're *also* the only place vitals trend is shown, so AT users get the number but never the trend. Acceptable for v1; note it.

---

## 2. Contrast (computed from actual mockup hex)

**Verdict: load-bearing text has multiple sub-AA failures. The team darkened amber to an "ink" for labels (good instinct) but then used the *undarkened* amber in many other text/graphic spots.** Threshold: 4.5:1 normal text, 3:1 large text & UI components.

Confirmed **FAILURES**:

- **[high]** **Placeholder & disabled text fails everywhere.** `--text-disabled #97A9AA` on white = **2.45:1** (on surface-muted **2.22:1**). This token is used for: global search placeholder (`tb-search .ph`), all picker placeholders, the RRN "감사기록" sub-label (`reveal-btn .audit`, 8px!), `perm-desc`, slot "마감" tags, `slot.full` disabled time text, date-chip "off" numerals, and form caption text. Placeholders that state *what to type* and disabled-control text that states *why it's disabled* are information, and they're below even the 3:1 large-text floor in several cases. The spine's own SOAP decision (`.decision-log.md` L156) says "흐린 텍스트는 저가 모니터서 안 보이며" and bumped SOAP placeholder to `text-muted` — but that lesson was **not propagated** to the dozens of other `text-disabled` placeholders. *Fix:* never use `#97A9AA` for any text conveying meaning; floor placeholders at `text-muted #54686A` (5.89:1) or darker.

- **[high]** **Raw amber `#BC7E12` as text/glyph fails at 3.43:1** (text AA needs 4.5). It's used as: KPI "접수" — wait, KPI uses `-ink` (ok) — but raw amber appears as the **noshow glyph ● color** in the calendar (`key-appointment-calendar.html` L558 `color:var(--st-noshow-ink)` — ok there) **and as the `--st-checkin` dot/swatch fills**, and notably the DESIGN.md mapping (`status-received: #BC7E12`) is the documented token for "접수" status; any place that renders a label in raw `#BC7E12` (rather than `#8A5D09` ink) fails. The mockups mostly remembered to swap to `-ink` for labels, but the **token contract in DESIGN.md is a trap**: `status-received: '#BC7E12'` with a separate `status-received-ink` "for white-bg legibility" invites an implementer to use the non-ink amber for text and ship a 3.43:1 label. *Fix:* in DESIGN.md, explicitly forbid `#BC7E12` as a text/glyph color on light surfaces; document that only `-ink` may touch text.

- **[medium]** **Green 급여 pay-chip text on its own tint = 4.08:1** (`#2C8466` on green-9% fill, `key-encounter-hub.html` L417 / `key-billing.html` L271). Sub-AA for the chip's small (9.5px) bold text. Borderline but it's a money/coverage distinction on the billing screen. *Fix:* darken the green ink for on-tint use, or drop the tint and put green text on white (4.57:1, barely passing — also marginal).

- **[medium]** **Nav active item: teal text on teal-10% fill = 4.29:1** (`.nav-item.active`, all desktop mockups). Just under AA for 13px text. *Fix:* darken active-nav text to `primary-hover #0A6675` or reduce reliance on the tint.

- **[medium]** **Focus ring is weak.** `--ring #2C9FB0` vs white = **3.14:1** (just clears the 3:1 UI minimum) but vs the `--border #D9E5E5` it sits against = **2.43:1**, i.e., the focus ring may not be *distinguishable from the resting border* on bordered controls. WCAG 2.4.13 (focus appearance) effectively wants the focus indicator to contrast against adjacent colors. *Fix:* thicken the focus ring (≥2px) AND/OR darken it toward `#0E7C8E`; never rely on the ring's hue alone.

- **[low]** `--border #D9E5E5` on white = **1.29:1**. Fine for a hairline *separator* (decorative), but the design leans on 1px hairlines to *contain regions* ("중요도 위계 + 헤어라인"). At 1.29:1 those borders are invisible to low-vision users and on glare-y clinic monitors — the very failure mode the team obsessed over for shadows applies to their hairlines too. *Fix:* acknowledge hairlines are not a perceivable boundary for low-vision; ensure region separation also survives via spacing/heading, which it mostly does.

- **[low]** Sidebar section caps `#8a939b` (3.12:1) and collapsed-sidebar caps `#9aa3aa` (2.56:1) — these are ALL-CAPS labels ("운영", "환자"); the collapsed one fails. Minor (group labels), but `#9aa3aa` at 8.5px uppercase is essentially unreadable.

Passing (verified, for the record): text-primary 17.46:1; text-muted 5.89:1; amber-ink 5.75:1; indigo 6.92:1; rose 5.05:1; slate 4.72:1; teal-on-white 4.89:1; white-✓-on-teal 4.89:1.

- **[medium]** **`DESIGN.md` states NO explicit contrast ratios.** EXPERIENCE.md L143/L149 punts: "대비 수치 등 시각값은 DESIGN.md에 있다" / "수치는 DESIGN.md" — but DESIGN.md's Colors section lists hexes with **zero ratios and zero AA claims**. The cross-reference is circular: each doc says the numbers live in the other. There is no stated target (AA vs AAA), no per-pair table, no "these combinations are load-bearing and verified" list. *Fix:* add an explicit contrast table to DESIGN.md with computed ratios and an AA conformance statement; flag the failing pairs above.

---

## 3. Keyboard operability

**Verdict: asserted as a "first-class primitive," specified almost nowhere, and contradicted by the mockups.**

- **[high]** **The mockups are not keyboard-operable as built.** Interactive elements are non-focusable, non-semantic spans/divs throughout:
  - Sidebar nav items are `<a>` with **no `href`** (`key-waiting-board.html` L393+) → not in the tab order.
  - RBAC checkboxes are `<span class="cbx on">` (`key-rbac-matrix.html` L466+) — not focusable, not toggleable, no `role="checkbox"`/`aria-checked`. The entire permission matrix is keyboard-dead.
  - Calendar slots are `<div class="slot">` (`key-appointment-calendar.html` L545+) — booking, the core action, is mouse-only.
  - SOAP body rows are `<div class="soap-br">` with `cursor:text` (`key-encounter-hub.html` L855+) — they *look* editable but are divs; no `contenteditable`, no `<textarea>`, no tabindex. The product's signature input surface is not reachable or typable by keyboard in the artifact.
  - Sort toggles, view toggles (일/주), order tabs, dx-toggle (주/부상병), payment-method segs — all `<span>`.

  These are "just mockups," but they are the **승격된 reference** the spine points implementers to ("구성 레퍼런스: mockups/", EXPERIENCE.md L69), and they model an inaccessible component structure. *Fix:* the spine must state that all of these become real `<button>`/`<input>`/`role`-bearing widgets, and the mockups should not be cited as structural truth for interaction.

- **[high]** **No tab order, no focus-visible spec, no grid keyboard model.** EXPERIENCE.md L138 says only "포커스 순서/탭 이동 = 읽기 순서와 일치" and "Esc closes top modal." That's it. For a dense clinical app this is nowhere near enough:
  - The **RBAC 22×5 matrix** needs a 2D arrow-key roving-tabindex model (no one wants to Tab through 110 cells). Unspecified.
  - The **slot grid** (time × doctor) needs arrow navigation + Enter-to-book. Unspecified.
  - The **SOAP ledger** needs a defined order (S→O→A→P, skip the header action buttons or not?) and a way to reach the per-section action buttons (이전기록/템플릿/활력 가져오기/오더 연결). Unspecified.
  - The **vitals/timeline left pane** is read-only but has clickable timeline items + "전체 이력 보기" — keyboard reachability unstated.
  *Fix:* add a keyboard-interaction spec per complex component (grid pattern, roving tabindex, arrow keys, Enter/Space activation, Esc).

- **[medium]** **Command palette (Ctrl K) is the one bright spot** — shadcn `Command`, `aria-live` on results (EXPERIENCE.md L135). Good. But it's also being leaned on as the universal escape hatch; it doesn't substitute for making the matrix/grid/ledger directly operable.

- **[medium]** **Reveal (표시) and other icon-only/compound controls** need a defined keyboard activation + focus-return behavior (after reveal, where does focus go? is the now-revealed RRN announced?). Unspecified.

- **[low]** **Modal/sheet/peek scope:** booking-peek and dialogs inherit shadcn focus-trap behavior (reasonable default), and the "modal stack = 1 level" rule (EXPERIENCE.md L69) helps. But focus-trap, initial-focus, and focus-restore-on-close are assumed, never stated. Confirm they're required, not just inherited.

---

## 4. Touch targets

**Verdict: patient app passes; staff desktop has sub-spec dense controls (acceptable for desktop pointer, but some are too small even for that, and there's no keyboard/AT compensation).**

- **[low]** **Patient app meets ≥44px** — verified: slots 46px (`key-patient-app.html` L182), pills min 54px (L135), CTA 54px (L205), tabs ~50px tall (L303–306), date chips 78px (L157). Good. *But:* the `.back` and `.av` buttons are 34px (L115–119), under 44px, and the bottom-tab badge target is tiny. Minor.

- **[medium]** **Staff desktop targets are genuinely small.** Row-action ghost buttons are 11.5px text with ~4px padding → ~24px tall (`key-waiting-board.html` L297–299). Status dots are 8px. The `reveal-btn` is ~16px tall with an 8px sub-label. RBAC cells are 22px boxes in 42px rows. WCAG 2.5.8 (target minimum) wants 24×24px CSS; several of these are right at or below it. Desktop+mouse tolerates more, but a clinician with a tremor or using a touchscreen-equipped clinic PC will mis-hit. *Fix:* floor interactive desktop targets at 24×24px effective hit area (padding counts); enlarge the reveal button and row actions.

- **[low]** The `rm`/`x` delete buttons in dx-chips and order-items are 20×20px (`key-encounter-hub.html` L351, L422) — destructive actions below the 24px floor. *Fix:* enlarge, and these especially deserve a confirm or undo since they're tiny + destructive.

---

## 5. Screen reader / semantics

**Verdict: BROKEN. This is the report's headline gap.** Nothing in the spine or mockups addresses assistive technology beyond one `aria-live` mention for the command palette and `aria-hidden` on sparklines.

- **[critical]** **No ARIA, no roles, no labels, no live regions — anywhere.** Search of all six mockups: the only `aria-*` is `aria-hidden="true"` on decorative sparklines. There is no `role`, no `aria-label`, no `aria-live`, no `aria-checked`, no `<label for>`. EXPERIENCE.md's `Accessibility Floor` does not mention screen readers, AT, ARIA, or semantics **at all**. For a system that is legally and clinically sensitive (RRN, allergies, prescriptions, audit), shipping with no AT story is the highest-impact failure here.

- **[critical]** **Status conveyed only visually.** A3 badges render as `<span><dot/><lbl>진행중</lbl></span>` — a sighted-only construct. A screen-reader user gets "진행중" text (ok-ish for status text) but the **allergy/safety alert** (`alert-row`, `key-encounter-hub.html` L626) has no `role="alert"`/`aria-live` — the single most safety-critical element on the screen is not announced. *Fix:* allergy/safety alert must be `role="alert"` or a live region; status changes that matter (e.g., realtime row updates) need polite live regions.

- **[critical]** **409 toasts are not announced.** The transition-conflict toast ("이미 완료된 진료입니다", `key-encounter-hub.html` L985) is a positioned `<div>` with no `role="status"`/`role="alert"`/`aria-live`. A screen-reader or low-vision user who triggers a 409 gets no feedback — they think their action worked. Same for the autosave indicator. *Fix:* toasts → live region; spec which politeness level (409 = assertive).

- **[critical]** **Masked RRN reveal is not announced.** The reveal flow is a security/audit centerpiece (권한 게이트 + 감사 로그), but: the button (`reveal-btn`) is `<button>` with text "표시" + tiny "감사기록" — no `aria-label` explaining it reveals sensitive data and is audited; and crucially **the revealed value's appearance is not announced** (no live region), so an AT user can't perceive the result, and worse, can't perceive that an *audited* action just occurred. The second reveal button (연락처, L657) has no audit sub-label at all. *Fix:* `aria-label` on the control ("주민번호 표시 — 조회 시 감사 로그 기록됨"); announce the revealed value via live region; keep the audit-warning in the accessible name.

- **[high]** **Icon-only buttons have no accessible name.** Bell (`tb-bell` "♢"), sidebar toggle ("≡"), collapsed-sidebar nav (icon glyphs + a visual-only `.tip` tooltip, `key-encounter-hub.html` L585–595), datepick arrows (◀▶), order-tab counts, dx delete (×). Several have `title=` (e.g., tb-bell L434) which is weak/unreliable for AT; many have nothing. The collapsed sidebar's CSS `.tip` is a hover-only `<span>` — not an accessible name. *Fix:* `aria-label` on every icon-only control; do not rely on `title` or CSS tooltips.

- **[high]** **RBAC matrix has no table semantics for AT.** Even if the spans become real checkboxes, the spine doesn't require `<th scope>`, row/column header association, or accessible names per cell ("의사 — 처방 발행 — 허용"). A 110-cell grid with no header association is unusable with a screen reader. *Fix:* require proper `<table>` header scoping + per-checkbox accessible name composed of row+column.

- **[medium]** **`lang="ko"` is set (good)**, but mixed Korean/English/code (KCD codes, "SpO₂", "HbA1c") and the formal serif legal form have no pronunciation/lang hints. Minor.

---

## 6. Motion / forms / errors

- **[high]** **Reduced motion is entirely unaddressed and explicitly punted.** `[OPEN] 모션/애니메이션` (EXPERIENCE.md L231, `.decision-log.md`). The realtime board updates rows live (≤5s), toasts slide, the live-dot has a glow, skeletons presumably shimmer. None of this references `prefers-reduced-motion`. For vestibular-sensitive users, live-updating dense tables + motion is a real problem. *Fix:* commit now to honoring `prefers-reduced-motion` (no shimmer, no slide, instant state swaps); don't leave it as "fine-tune after v1."

- **[high]** **422 validation is associated to fields visually but not for AT.** EXPERIENCE.md L125/L138 is good on behavior (inline message + focus move to first error field). But there's no `aria-invalid`, no `aria-describedby` linking the message to the field, no `aria-required`. The mockup shows `.field-err`/`.merr` as sibling `<div>`s with no programmatic association (`key-encounter-hub.html` L395, L1007). Moving focus to the field helps, but the *error text* won't be announced unless wired. *Fix:* require `aria-invalid` + `aria-describedby` on errored fields; announce the summary via live region.

- **[medium]** **Required fields are marked with a color-only asterisk.** `.req { color: var(--danger) }` "*" (dx-block L332, booking-peek labels L377). The asterisk shape helps a little, but it's the classic "is `*` required or footnote?" ambiguity, and it's not programmatically `required`/`aria-required`. The danger-red asterisk also rides on color. *Fix:* add `aria-required`, and consider an explicit "(필수)" text for the floor.

- **[medium]** **403 disabled controls hide their reason from AT.** The pattern (비활성 버튼 + 잠금 ⊘ + hover 사유 툴팁) is great for sighted learning but the reason is a hover-only `.ptip` (`key-encounter-hub.html` L452) and the button is genuinely `disabled` — disabled buttons aren't focusable, so a keyboard/AT user can't even reach it to discover the tooltip. The "학습 유도" goal silently excludes AT users. *Fix:* use `aria-disabled` (focusable) instead of `disabled` so the reason can be read, and put the reason in the accessible name/`aria-describedby`, not a hover tooltip.

- **[low]** **RRN validation messaging** (HARD/SOFT, EXPERIENCE.md L125) is well thought out behaviorally; just ensure the SOFT checksum warning is a non-blocking live-region announcement, not color-only.

---

## 7. Patient app specifics (elderly users)

- **[high]** **No font-size floor and no honoring of user/browser zoom or OS large-text.** Plain language is genuinely good (verified: "하루 1번, 아침 식사 후 한 알", trust note, easy-term diagnoses). Type is larger than desktop (15–16px body, 21–22px leads). **But:** body sets a fixed `font-size:15px` and the phone frame is a **fixed 390×812 `.phone` with `height:812px` and `overflow:auto` inner scroll** (`key-patient-app.html` L84–87). A fixed-px, fixed-height shell is exactly what breaks when an elderly user cranks OS font size or browser zoom — content won't reflow, it'll clip or inner-scroll awkwardly. There's no `rem`/`em` scaling commitment, no statement that the layout reflows at 200% zoom (WCAG 1.4.4 / 1.4.10). The 58yo+ persona is named in flows but the one thing that helps them most — respecting their system text size — is not specified. *Fix:* commit to relative units, reflow at 200% zoom, and respect OS dynamic-type; state a minimum readable body size and that it scales.

- **[medium]** **Disabled/마감 slot text is the failing `#97A9AA`** on muted (2.22:1, see §2) — an elderly user can't read which slots are full vs open, undermining the whole booking flow. The "마감" tag label is also `#97A9AA`. *Fix:* darken disabled-slot text; the "마감" label must be legible.

- **[medium]** **Bottom-tab labels + icons are CSS-glyph constructs** (`gl-cal`, `gl-doc`, `gl-user`) with no accessible name beyond the visible label; the "마이" badge ("1") is decorative-positioned with no AT meaning. The tabs are `<div>` not `<button>`/`role="tab"`. Same keyboard/semantics problem as desktop, on the surface most likely to have AT users (elderly screen-reader/VoiceOver users). *Fix:* real tab semantics + accessible names.

- **[low]** Emoji are used as functional icons (💊 🧪 🔒 📅) in the patient app. Emoji get announced by screen readers with their unicode name ("pill", "test tube") which is inconsistent and sometimes wrong-language. *Fix:* `aria-hidden` the emoji and label the row, or replace with labeled icons.

---

## Severity tally

| Severity | Count |
|---|---|
| Critical | 4 |
| High | 9 |
| Medium | 13 |
| Low | 11 |
| **Total** | **37** |

**Critical (fix before any claim of accessibility):**
1. No ARIA/semantics/AT story anywhere (§5).
2. Safety-critical allergy alert not announced — no `role="alert"`/live region (§5).
3. 409 toasts (and autosave) not announced to AT (§5).
4. Masked RRN reveal: control unlabeled + revealed value + audit event not announced (§5).

**The through-line:** the design solved *colorblindness + cheap monitors* thoroughly and then declared accessibility done. Screen-reader users, keyboard-only users, low-vision users (contrast/zoom), and motion-sensitive users are essentially unconsidered. The redundant-encoding work is real and worth keeping — but on its own it is a thin slice of an accessible clinical product, and the spine should stop presenting "음영 비의존" as if it were the accessibility floor. It's one plank of it.
