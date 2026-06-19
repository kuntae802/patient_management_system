---
name: patient_management_system
description: 중소병원 외래용 환자관리 시스템 — Linear식 미니멀·고밀도에 차분한 클리니컬 틸-블루를 입힌 라이트 전용 임상 UI. shadcn/ui on Tailwind 4 위의 브랜드 델타만 정의.
status: final
sources:
  - "{planning_artifacts}/prds/prd-patient_management_system-2026-06-18/prd.md"
  - "{planning_artifacts}/architecture.md"
  - "{planning_artifacts}/briefs/brief-patient_management_system-2026-06-18/brief.md"
  - "{project-root}/_bmad-output/brainstorming/brainstorming-session-2026-06-17-05-00.md"
updated: 2026-06-19
colors:
  # 브랜드 델타 — shadcn 기본값 위 override만 명시.
  # 여기 없는 토큰(popover, card, input, secondary, accent, muted-foreground, destructive-foreground 등)은
  # shadcn 기본값을 상속한다. teal = ACTION/BRAND 전용, 상태색으로 절대 미사용.
  #
  # ── 대비 정책: WCAG 2.1 AA. 아래 모든 비율은 surface(#FFFFFF) / background(#FAFCFC) 기준.
  #    본문/UI 텍스트 ≥ 4.5:1 · 큰 텍스트(≥18.66px bold / 24px)·비텍스트 UI 컴포넌트 ≥ 3:1.

  # ── 브랜드/액센트 (shadcn primary override) — 클리니컬 틸-블루
  primary: '#0E7C8E'              # 클리니컬 틸-블루 · 버튼·링크·포커스 링·활성 내비 전용 (on white 4.89:1)
                                  #   ⚠ 작은 텍스트/활성 내비 잉크로는 primary-hover 사용(틴트 위 4.5 미달)
  primary-foreground: '#FFFFFF'
  primary-hover: '#0A6675'        # primary 호버/누름 + primary 버튼 1px 보더 + primary 작은-텍스트 잉크 (on white 6.62:1)
  ring: '#0A6675'                 # 포커스 링 (shadcn ring override) — vs white 6.62:1, vs border #D9E5E5 5.14:1 (≥3:1 양쪽 충족)
                                  #   (구 #2C9FB0 = 3.14:1/2.43:1 — 인접 보더 대비 3:1 미달로 어둡게)

  # ── 진료/검사/오더 상태 — 5상태 기능색 (상태 전용, 액센트와 충돌 회피)
  # 색 + 도형(○●◐✓✕) 중복 인코딩. 결제상태·예약상태도 같은 색을 재사용.
  status-scheduled: '#64758A'     # 예약   · 슬레이트 · 글리프 ○ (on white 4.72:1)
  status-received: '#BC7E12'      # 접수   · 앰버     · 글리프 ● — fill/dot 전용 (텍스트 3.43:1, AA 미달)
                                  #   ⚠ 흰 배경 위 텍스트/라벨/글리프로 절대 사용 금지 → status-received-ink 사용
  status-received-ink: '#8A5D09'  # 흰/bg 위 앰버 라벨·잉크 (on white 5.75:1) — 앰버가 텍스트로 닿는 유일한 값
  status-inprogress: '#4F46C7'    # 진행중 · 인디고   · 글리프 ◐ (on white 6.92:1)
  status-done: '#2C8466'          # 완료   · 그린     · 글리프 ✓ — fill 전용 (텍스트 on white 4.57:1 경계)
  status-done-ink: '#1F6B50'      # 작은/틴트 위 그린 라벨·잉크 (on white 6.41:1) — 그린이 작은 텍스트로 닿을 때
  status-cancelled: '#C2433B'     # 취소   · 로즈레드 · 글리프 ✕ (라벨 취소선) (on white 5.05:1)
  danger: '#C2433B'              # 안전 경고·삭제·badge — 취소색과 동일 hex 공유

  # ── 중립 램프 (테마 #4 클리니컬 틸-블루, 목업서 그대로 사용)
  background: '#FAFCFC'           # 앱 캔버스 (살짝 틸 기운 오프화이트)
  surface: '#FFFFFF'             # 카드·패널·시트 표면
  surface-muted: '#EFF5F5'        # 호버·읽기전용 톤 레이어·테이블 헤더 틴트
  border: '#D9E5E5'             # 1px 헤어라인 (shadcn border override)
  text-primary: '#0E1C1D'        # 본문·제목 (on white 17.46:1)
  text-muted: '#54686A'          # 보조·섹션 라벨·캡션·placeholder·가이드 (on white 5.89:1)
                                  #   ✦ placeholder/가이드/읽혀야-하는 보조 텍스트는 모두 여기를 사용(↓ text-disabled 아님)
  text-disabled: '#607274'       # 진짜 비활성/inert 비필수 요소 전용 (on white 5.05:1 / bg 4.91:1 / surface-muted 4.58:1)
                                  #   (구 #97A9AA = 2.45:1 — AA 미달로 어둡게. 의미 있는 텍스트엔 text-muted 사용)
typography:
  # 본문/라벨/캡션 = 아래 스택 위에 역할별 size/weight만 지정. shadcn Geist는 교체됨(Pretendard-led).
  # 스택은 윈도우 우선 · 네트워크/@font-face 없음(번들 self-host) → 윈도우/맥/리눅스 동일 렌더.
  font-family-base: "'Pretendard Variable', Pretendard, 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', -apple-system, system-ui, sans-serif"
  page-title:
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  section:
    fontSize: 13px
    fontWeight: '600'
    note: 'muted({colors.text-muted}) · 섹션/패널 헤더'
  body:
    fontSize: 13px            # 본문 13, 임상 작성 본문(SOAP)은 13–14
    fontWeight: '400'
    lineHeight: '1.5'
  caption:
    fontSize: 12px
    fontWeight: '400'
    note: 'muted({colors.text-muted}) · 메타/타임스탬프'
  numeric:
    note: 'tabular-nums (대기번호·시각·카운트·금액·주민번호) — 세로 정렬 보장'
  legal-serif:
    fontFamily: "'Batang', 바탕, serif"
    note: '인쇄 법정 서식(진료비 계산서·영수증·세부산정내역서) 전용 예외. 화면 UI에는 미사용.'
rounded:
  # 목업 실측값. shadcn 기본보다 약간 부드럽고 일관된 라운드.
  sm: 5px       # 작은 칩·kbd·셀렉트 내부 요소
  DEFAULT: 7px  # 버튼·셀렉트·인풋
  md: 8px       # 검색바·벨/아바타 박스·로고
  lg: 10px      # 카드·히어로·경고 행
  xl: 11px      # 큰 패널 컨테이너
  full: 9999px  # 카운트 pill·상태 점·아바타
spacing:
  # Tailwind 4 기본 4-base 스케일 상속. 아래는 이 제품 고유 리듬/실측.
  note: 'big-seams-dense-interiors — 섹션 사이 여백 크게(또렷한 경계), 섹션 안 고밀도 유지'
  content-pad: 20px 24px       # content 영역 패딩 (waiting-board)
  table-cell: 8px 14px         # 고밀도 테이블 셀 패딩
  pane-context: 280px          # 진료 허브 좌 컨텍스트 패널
  pane-orders: 320px           # 진료 허브 우 오더 패널 (1366×768@150% → 300px)
  sidebar-w: 240px             # 펼친 사이드바 (아이콘 접힘 = 60px)
  topbar-h: 52px
  soap-input-min-height: 132px # SOAP 본문 입력 행 최소 높이 (입력 affordance)
components:
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    border: '1px solid {colors.primary-hover}'
    hover: '{colors.primary-hover}'
    radius: '{rounded.DEFAULT}'
    note: '액션 1급. 화면당 주 동작 1개에 절제 사용.'
  button-ghost:
    background: '{colors.surface}'
    foreground: '{colors.text-muted}'
    border: '1px solid {colors.border}'
    hover-bg: '{colors.surface-muted}'
    radius: '{rounded.DEFAULT}'
    key-variant: '다음-액션 행 버튼은 teal 잉크 + 옅은 teal 채움(.key)'
  status-badge:
    # A3 = 작은 점 + 라벨 텍스트에 상태색 (배경 0). 범인은 점 크기가 아니라 색 면적.
    dot-size: 8px
    dot-radius: '{rounded.full}'
    label-color: '상태색과 동일(접수만 status-received-ink)'
    glyph: '예약 ○ · 접수 ● · 진행중 ◐ · 완료 ✓ · 취소 ✕'
    cancelled: '라벨 line-through (취소 전용)'
    mapping:
      scheduled: '{colors.status-scheduled}'
      received: '{colors.status-received}'
      inprogress: '{colors.status-inprogress}'
      done: '{colors.status-done}'
      cancelled: '{colors.status-cancelled}'
  waiting-list-row:
    border-bottom: '1px solid {colors.border}'
    hover: '{colors.surface-muted}'
    section-header: '점 + 컬러 상태명 + 카운트 pill · 활성도 순 그룹 · 완료/취소 접힘+muted'
    cell-pad: '{spacing.table-cell}'
    numeric: 'tabular-nums (대기번호·시각·대기시간)'
  patient-banner:
    background: '{colors.surface}'
    border-bottom: '1px solid {colors.border}'
    rrn-masked: "710314-2****** (기본 마스킹)"
    reveal-control: '권한 게이트 + 감사 로그 표시 버튼(눈 아이콘 + "감사기록")'
    state-pill: '진행중 = status-inprogress 점 + 옅은 채움 + 보더'
  allergy-alert:
    # 음영 비의존 — 채움 + 보더 + 굵기로 표현(어떤 모니터서도 보이게).
    background: 'color-mix({colors.danger} 8%, {colors.surface})'
    border: '1px solid color-mix({colors.danger} 32%, {colors.border})'
    icon-box: '{colors.danger} 채움 · 흰 ! · 굵게'
    label: '{colors.danger} · 800 weight · UPPERCASE "환자 안전 경고"'
    chip: '흰 배경 + danger 보더 + danger 잉크 pill'
    persistence: '배너 상단 상시 노출 · can’t-miss'
  soap-ledger:
    # 진료 기록 섹션 = full-bleed 1열 표(ledger). 좌우 테두리 없음, 가로 hairline만.
    full-bleed: 'margin 0 -16px · 섹션 폭 전체 가로 rule'
    row-rule: '1px solid {colors.border} (행 상단)'
    header-row: '{colors.background} 틴트 · S/O/A/P 컬러 배지 + 한글 + 영문 + 설명어 + 우측 액션'
    badge-colors: 'S={colors.status-inprogress} · O={colors.primary} · A={colors.status-received-ink} · P={colors.status-done}'
    body-row-min-height: '{spacing.soap-input-min-height}'
    body-row-bg: '{colors.surface}'
    cursor: 'text'
    hover: '{colors.surface-muted}'
    focus-writing: '좌측 3px teal 액센트 + color-mix({colors.primary} 5%, surface) 틴트 (음영 아님)'
    placeholder: '{colors.text-muted} 가이드 (단독 의존 ❌ · "무엇을 적나" 안내)'
  diagnosis-block:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
    placement: '진료 기록 섹션 상단(SOAP 위)'
    picker: 'KCD-8 검색 피커 (free-text 금지 · 마스터 검색)'
    code-chip: 'status-inprogress 잉크 · 주/부상병 토글'
  order-panel:
    width: '{spacing.pane-orders}'
    border-left: '1px solid {colors.border}'
    tabs: '처방/검사/영상/처치 (카운트 배지)'
    item: '{colors.surface} 카드 + 보더 · 추적(오더→수행) 라인'
    pay-chip: '급여=status-done · 비급여=status-received-ink'
    add: '약품/수가 검색 피커 (마스터 검색)'
    permission-denied: '비활성 버튼 + 잠금(⊘) + hover 사유 툴팁 (숨기지 않고 학습 유도)'
  fee-table:
    auto-tag: '자동 산정 (teal "자동" 마커)'
    amount: 'tabular-nums · KRW 정수 · "원" 접미'
    pay-status-badge: '미수납=status-cancelled · 부분=status-received · 완료=status-done (A3)'
    legal-form: '진료비 계산서/영수증/세부산정내역서 = Batang serif 예외'
  slot-block:
    # 예약 캘린더 슬롯 — 채움 + 테두리 + 패턴(음영 비의존).
    note: '열=의사 · 30분 고정 · 기본 보기=일(Day)'
    states: '가능/예약/노쇼/휴진(빗금 패턴) = 채움+테두리+패턴'
    double-booking: '인라인 차단 (409)'
  permission-cell:
    # RBAC 매트릭스 셀 — 행=권한(6도메인 22개) × 열=역할(5).
    allowed: '{colors.primary} 채움 + ✓'
    denied: '빈 셀'
    sensitive: '⚠ 마커'
    apply: '즉시 적용(저장 버튼 없음) + 감사 기록'
  patient-app:
    note: '모바일/반응형 (Flutter webview 셸이 반응형 웹 로드)'
    type-scale: '데스크톱보다 큰 타입 · 큰 터치 타깃'
    nav: '하단 3탭 (예약 / 내 기록 / 마이)'
    tone: '쉬운 말 (직원 화면보다 평이)'
    time-format: '12시간 (오후 2:30) — 직원은 24시간 (14:30)'
---

## Brand & Style

이 제품은 **shadcn/ui + Tailwind 4** 위에 세워진다. 따라서 이 DESIGN.md는 shadcn 기본값을 통째로 상속하고, **브랜드 레이어 델타만** 명시한다 — 색(teal + 5상태 기능색 + 중립 램프), 타이포(Pretendard 교체), 코너 반경, 그리고 임상 특화 컴포넌트. shadcn에서 그대로 오는 80% 컴포넌트(Button 변형·Dialog·Sheet·Popover·Command·Tabs·Toast 등)는 shadcn 시각 스펙을 따른다. 명시되지 않은 토큰은 shadcn 기본값을 상속한다.

미학 자세는 사용자 표현 그대로 **"Linear 같은 미니멀 고밀도 + 차분한 임상 블루"**다. Linear DNA에서 가져오는 것: 밀도 규율, 1px 헤어라인 경계와 낮은 elevation, 단일 액센트 절제(나머지는 무채색), 상태=작은 컬러 점/라벨, 키보드 속도감. 이 제품용으로 바꾼 것: Linear의 다크 기본 → **라이트 전용**(임상 환경·종일 사용·인쇄물 일관), 인디고/퍼플 액센트 → **차분한 클리니컬 틸-블루**, 소프트웨어 카피·놀이 톤 제거 → 안전·신뢰. 의료 특수상 색을 *기능적으로*(상태/위험/급여구분) 써야 하므로 액센트는 절제하되 상태색 팔레트는 명확히 정의한다.

제품 보이스는 병원의 **"운영 기억(operating memory)"**이다. 설계 중심 페르소나는 **신규 직원(암묵지 0)** — 모든 화면의 합격 기준은 "선임 없이도 올바르게 일할 수 있는가"이고, **"다음에 할 일(next-action)"이 1급 UX 패턴**이다. 동시에 강제가 베테랑을 느리게 하지 않아야 한다(브리프 §8.1 반대지표). 시각적으로 이는 *가이드하되 방해하지 않는* 절제로 나타난다.

## Colors

팔레트는 (1) **단일 브랜드 액센트 teal**, (2) **5상태 기능색**, (3) **중립 램프** 세 갈래다. 나머지는 shadcn 기본값.

**대비 정책 — WCAG 2.1 AA (명시 약속).** 본문/UI 텍스트는 배경 대비 **≥ 4.5:1**, 큰 텍스트(**≥ 18.66px bold 또는 24px**)와 비텍스트 UI 컴포넌트(포커스 링·보더·아이콘 등)는 **≥ 3:1**. 아래 모든 조합 비율은 **surface `#FFFFFF` / background `#FAFCFC`** 기준으로 산정·기재한다. 검증된 텍스트 조합: `text-primary` 17.46:1 · `text-muted` 5.89:1 · `status-received-ink` 5.75:1 · `status-inprogress` 6.92:1 · `status-cancelled` 5.05:1 · `status-scheduled` 4.72:1 · `primary` on white 4.89:1 · `primary-hover` 6.62:1 · `status-done-ink` 6.41:1 · `text-disabled` 5.05:1.

- **클리니컬 틸-블루 `#0E7C8E` (`{colors.primary}`)** 는 **액션/브랜드 전용**이다. 주 버튼, 링크, 포커스 링, 활성 내비, 다음-액션 affordance, "자동 산정" 마커, RBAC 허용 셀에만 쓴다. **상태색으로는 절대 쓰지 않는다** — teal이 상태로 번지면 액센트의 의미가 흐려지고 인디고(진행중)와 충돌한다. 호버/누름은 `{colors.primary-hover}` `#0A6675`. **대비 규칙:** primary는 **채움/큰 텍스트/굵은 텍스트로는 OK**(on white 4.89:1)지만, **작은 텍스트나 활성 내비 잉크로는 `{colors.primary-hover}` `#0A6675`(6.62:1) 또는 그 이상으로 어둡게** 써야 한다 — teal 10% 틴트 위 small teal 텍스트는 4.29:1로 AA 미달이기 때문. 포커스 링은 `{colors.ring}` `#0A6675` 로, 흰 배경(6.62:1)·인접 보더 `#D9E5E5`(5.14:1) 양쪽에서 **≥ 3:1**을 확보한다(구 `#2C9FB0`은 보더 대비 2.43:1로 미달이라 어둡게 교체).

- **5상태 기능색** — 진료상태(예약/접수/진행중/완료/취소)는 **색 + 도형(글리프)의 중복 인코딩**으로 표현한다. 색약 사용자와 저가·미보정 임상 모니터를 동시에 대응하기 위해 색 하나에 기대지 않는다.
  - 예약 = 슬레이트 `#64758A` ○ (텍스트 4.72:1)
  - 접수 = 앰버 `#BC7E12` ● — **앰버는 채움/점 전용**(텍스트 3.43:1로 AA 미달). **흰 배경 위 앰버 텍스트·라벨·글리프는 반드시 `{colors.status-received-ink}` `#8A5D09`(5.75:1)** 를 쓴다. 즉 raw `#BC7E12`가 텍스트로 닿으면 안 된다.
  - 진행중 = 인디고 `#4F46C7` ◐ (텍스트 6.92:1)
  - 완료 = 그린 `#2C8466` ✓ — **채움은 OK**. 흰 배경 위 작은 텍스트(4.57:1 경계)나 그린 틴트 위에서는 `{colors.status-done-ink}` `#1F6B50`(6.41:1)를 쓴다.
  - 취소 = 로즈레드 `#C2433B` ✕ (라벨 취소선) (텍스트 5.05:1)
  진단 실험에서 확인된 핵심: 구분의 범인은 점 크기가 아니라 **색 면적**이었다 — 그래서 A3 방식(작은 점 + 라벨 텍스트에 상태색)을 채택했다. 5색은 서로, 그리고 액센트 teal과 최대한 분리되도록 골랐다.

- **상태색 재사용** — 같은 5색 의미 체계를 다른 상태머신에도 일관되게 빌려 쓴다. **결제상태**: 미수납=로즈(`status-cancelled`) · 부분=앰버(`status-received`) · 완료=그린(`status-done`). **급여구분**: 급여=그린 · 비급여=앰버 잉크. **예약상태**도 동일 색군. 사용자가 한 번 배운 색=의미가 화면 전체에 통한다.

- **`danger` `#C2433B`** 는 취소색과 **동일 hex**를 공유하되 의미축이 다르다(안전 경고·삭제·알림 badge·검증 오류). 알레르기/안전 경고처럼 놓치면 안 되는 신호의 기준색.

- **중립 램프** (테마 #4, 목업서 그대로): `background #FAFCFC`(살짝 틸 기운 캔버스) · `surface #FFFFFF`(카드 표면) · `surface-muted #EFF5F5`(호버·읽기전용 톤 레이어·테이블 헤더 틴트) · `border #D9E5E5`(1px 헤어라인) · `text-primary #0E1C1D`(17.46:1) · `text-muted #54686A`(5.89:1) · `text-disabled #607274`(5.05:1).

- **placeholder/disabled 텍스트 규칙 (load-bearing).** `text-disabled`는 **진짜 비활성·inert·비필수 요소에만** 쓴다(구 `#97A9AA` = 2.45:1로 AA 미달이라 `#607274`로 어둡게 교체). **placeholder("무엇을 적나" 안내)·가이드·읽혀야 하는 보조 텍스트(비활성 사유, 캡션성 안내 등)는 정보이므로 모두 `text-muted #54686A`(5.89:1)** 를 쓴다 — `text-disabled` 금지. 흐린 텍스트는 저가·미보정 임상 모니터에서 사라진다(SOAP placeholder를 `text-muted`로 올린 것과 동일 원칙을 전 화면에 적용).

## Typography

**Pretendard를 자체 호스팅(번들)** 한다 — `@font-face`/네트워크 없이 OS 무관 동일 렌더(윈도우·맥·리눅스 일관). 이것이 "맥처럼/윈도우처럼" 렌더 차이 문제의 근본 해결책이다. 폴백 스택은 **윈도우 우선**(주 타깃 = 한국 중소병원 데스크):

```
'Pretendard Variable', Pretendard, 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', -apple-system, system-ui, sans-serif
```

타입 스케일(역할):

| 역할 | size / weight | 비고 |
|---|---|---|
| page-title | 20 / 600 | letter-spacing -0.02em |
| section | 13 / 600 | `{colors.text-muted}` — 패널/섹션 헤더 |
| body | 13–14 / 400 | line-height 1.5 · 임상 작성 본문은 14 |
| caption | 12 / 400 | `{colors.text-muted}` — 메타·타임스탬프 |

숫자(대기번호·시각·카운트·금액·주민번호)는 **`tabular-nums`** 로 세로 정렬을 보장한다.

**법정 서식 serif 예외:** 인쇄용 법정 양식(진료비 계산서·영수증·세부산정내역서)만 **바탕(Batang) serif**를 쓴다. 종이 문서 관례에 맞춘 의도된 예외이며, 화면 UI에는 적용하지 않는다.

## Layout & Spacing

Tailwind 4의 4-base 스페이싱 스케일을 상속한다. 이 제품 고유의 리듬은 **big-seams-dense-interiors** — 섹션 *사이* 여백은 크게(또렷한 경계), 섹션 *안*은 고밀도. 고인지부하 임상 화면에서 각 영역이 "방"처럼 anchor를 잡되, 한 방 안은 정보 밀도를 유지한다.

**글로벌 셸:** 모든 6개 역할이 상속한다.
- 좌측 **사이드바**(접이식, 펼침 ~240px / 아이콘 접힘 ~60px) — 역할별 항목, RBAC 노출 게이트, 푸터 사용자+역할 배지.
- 상단 **탑바**(~52px) — 병원명, 전역 환자검색(`Ctrl K`), 날짜/시계, 실시간 표시, 알림 벨, 아바타/역할 메뉴. (윈도우 우선 → `Ctrl`, `⌘` 미사용.)

**3-pane 진료(진료 허브):** 상시 노출 환자 배너 아래 ① 좌 컨텍스트 ~280px(읽기전용) | ② 중앙 작성(flex, 가장 넓게 — primary) | ③ 우 오더 ~320px. 패널 사이 헤어라인 구분. 액션 바는 작업영역 하단 sticky. 1366×768 @150% 환경에선 우 오더를 320→300px로 줄이고 본문 폰트는 동일 유지(고밀도 설계의 반응형 하한).

데스크톱 콘텐츠 기준폭 ~1440px. 환자 앱만 모바일/반응형(하단 3탭 + 큰 타입·터치).

## Elevation & Depth

⭐ **KEY RULE: 그림자는 장식 보조일 뿐, 의미를 싣지 않는다. 음영만으로 어떤 신호도 전달하지 않는다.**

근거(사용자 발견): 외부/저가 모니터에서 미세 box-shadow·음영(안전경고 빨강 그림자, 버튼 내부 음영 등)이 안 보였다. 원인 = 모니터 대비/감마/HDR/나이트라이트/동적대비 + 저가 패널 한계. 실제 병원 모니터도 저가·미보정이므로, 음영에 의미를 실으면 현장에서 사라진다. 따라서 **중요 신호(안전경고·상태·버튼·입력 포커스)는 색 채움 + 테두리 + 글자 굵기로 표현**한다(어떤 모니터서도 보이게).

영역 분리는 **균일 카드 elevation이 아니라 중요도 기반 시각적 위계 + 1px 헤어라인 경계 + 톤 레이어링**으로 달성한다.

**v2→v4 교훈(기록):** 한때 섹션 명료성을 위해 회색 캔버스+흰 카드+옅은 elevation으로 *모든* 영역을 균일하게 카드화했으나(v2), 사용자가 "과함 + 여백은 v1이 더 좋음"으로 거부했다. 결론: 답은 균일 elevation/카드화가 아니라 ① 핵심 영역(진료기록) 강조 + ② 보조 영역 quiet 처리 + ③ 절제된 헤어라인 경계. 예컨대 진료 허브의 진료기록(SOAP)은 *테두리 없는 열린 캔버스*로 두어, 카드에 담긴 주변 영역들 속에서 *대비*로 도드라진다(박스가 아니라 열림+대비+타이틀+본문 대비로 강조).

읽기전용 참조 영역과 작업 영역은 미세한 **톤 차**(`surface-muted` vs `surface`)로 구분한다.

## Shapes

목업 실측 코너 반경 — shadcn 기본보다 약간 부드럽고 일관되되, "소비자 앱"이 아니라 "도구"로 읽히는 절제선을 유지한다.

- `sm` 5px — 작은 칩·`kbd`·셀렉트 내부 요소
- `DEFAULT` 7px — 버튼·셀렉트·인풋
- `md` 8px — 검색바·벨/아바타 박스·로고
- `lg` 10px — 카드·히어로·경고 행
- `xl` 11px — 큰 패널 컨테이너
- `full` 9999px — 카운트 pill·상태 점·아바타

## Components

shadcn 컴포넌트 다수(Dialog, Sheet, Popover, DropdownMenu, Tabs, Avatar, Separator, Command 등)는 그대로 쓴다. 아래는 브랜드/임상 특화 스펙. 각 행 끝의 **참조 목업**은 그 컴포넌트를 시각화한 파일이다. **충돌 시 이 스피너가 목업보다 우선한다(spines win on conflict).**

**참조 목업 (mockups/):** `key-waiting-board.html`(status-badge·waiting-list-row·셸) · `key-encounter-hub.html`(patient-banner·allergy-alert·soap-ledger·diagnosis-block·order-panel) · `key-billing.html`(fee-table·legal-form) · `key-appointment-calendar.html`(slot-block) · `key-rbac-matrix.html`(permission-cell) · `key-patient-app.html`(patient-app).

- **button-primary** — `{colors.primary}` 채움, `{colors.primary-foreground}` 글자, `1px {colors.primary-hover}` 보더, `{rounded.DEFAULT}`. 호버 `{colors.primary-hover}`. 화면당 주 동작 1개에 절제 사용.
- **status-badge (A3)** — 8px 점(`{rounded.full}`) + 라벨 텍스트에 상태색(배경 0). 글리프 ○●◐✓✕로 중복 인코딩. 취소는 라벨 취소선. **앰버(접수)는 점/채움만 raw `status-received` `#BC7E12`를 쓰고, 라벨 텍스트는 반드시 `status-received-ink` `#8A5D09`(5.75:1)** 로 렌더한다(raw 앰버 텍스트 3.43:1 금지). 그린(완료) 라벨이 작은 텍스트면 `status-done-ink`. → 참조 목업 `mockups/key-waiting-board.html`.
- **waiting-list-row** — 고밀도 헤어라인 행(셀 패딩 `{spacing.table-cell}`), 호버 `{colors.surface-muted}`, 행별 다음-액션 ghost 버튼. 목록 기본 = **그룹 섹션**(점+컬러 상태명+카운트 pill), 활성도 순(진행중→접수→예약→완료→취소), 완료/취소는 접힘+muted. 짧은 목록은 플랫 정렬로 충분. → 참조 목업 `mockups/key-waiting-board.html`.
- **patient-banner** — 상시 노출, `{colors.surface}` + 하단 헤어라인. 주민번호 기본 마스킹(`710314-2******`) + **권한 게이트 reveal 버튼**(눈 아이콘 + "감사기록" 라벨 = 감사 로그 대상). 우측 상태 pill = 진행중(`status-inprogress` 점 + 옅은 채움 + 보더). → 참조 목업 `mockups/key-encounter-hub.html`.
- **allergy-alert** — **음영 비의존**: `danger` 옅은 채움 + `danger` 보더 + 굵은 라벨 + danger 채움 아이콘 박스. 배너 상단 상시 노출, can't-miss. 알레르기 칩 = 흰 배경 + danger 보더 + danger 잉크. → 참조 목업 `mockups/key-encounter-hub.html`.
- **soap-ledger** — 진료 기록 섹션 = **full-bleed 1열 표**(섹션 폭 전체 가로 rule, 좌우 테두리 없음, `margin 0 -16px`). 각 파트 = 헤더 행(`{colors.background}` 틴트, S/O/A/P 컬러 배지[S=`{colors.status-inprogress}`·O=`{colors.primary}`·A=`{colors.status-received-ink}`·P=`{colors.status-done}`] + 한글 + 영문 + 설명어 + 우측 액션 버튼) + 본문 행. 입력 affordance: **본문 행 최소 높이 132px** + `cursor:text`, 호버 `surface-muted`, **포커스/입력 중 = 음영 아닌 좌측 3px teal 액센트 + 옅은 teal 틴트**, placeholder는 `text-muted` 가이드("무엇을 적나" 안내, 단독 의존 금지). 진단(상병)은 같은 섹션 상단에 v1 박스 스타일로 부착. → 참조 목업 `mockups/key-encounter-hub.html`.
- **diagnosis-block** — 진료 기록 섹션 상단(SOAP 위) 박스. KCD-8 검색 피커(free-text 금지), 코드 칩 = `status-inprogress` 잉크 + 주/부상병 토글. → 참조 목업 `mockups/key-encounter-hub.html`.
- **order-panel** — 우 ~320px, 좌측 헤어라인. 처방/검사/영상/처치 탭(카운트). 오더 아이템 카드 + 추적(오더→수행) 라인. 급여/비급여 pay-chip(그린은 작은 텍스트면 `status-done-ink` / 비급여는 `status-received-ink` 잉크). 약품·수가는 검색 피커(마스터, free-text 금지). 권한 거부 = 비활성 버튼 + 잠금(⊘) + hover 사유 툴팁(숨기지 않고 학습 유도). → 참조 목업 `mockups/key-encounter-hub.html`.
- **fee-table** — 자동 산정(teal "자동" 마커), 금액 tabular-nums·KRW 정수·"원". 결제상태 A3(미수납 로즈/부분 앰버 잉크/완료 그린 — 텍스트는 잉크값 사용). 법정 서식(legal-form) 미리보기는 Batang serif. → 참조 목업 `mockups/key-billing.html`.
- **slot-block** — 예약 캘린더 슬롯(열=의사, 30분 고정, 기본 보기=일). 상태(가능/예약/노쇼/휴진)는 **채움 + 테두리 + 패턴**(휴진=빗금, 음영 비의존). 더블부킹 인라인 차단(409). → 참조 목업 `mockups/key-appointment-calendar.html`.
- **permission-cell** — RBAC 매트릭스(행=권한 6도메인 22개 × 열=역할 5). 허용 = `{colors.primary}` 채움 + ✓, 민감 권한 ⚠ 마커. 즉시 적용(저장 버튼 없음) + 감사 기록. → 참조 목업 `mockups/key-rbac-matrix.html`.
- **patient-app** — 모바일/반응형. 데스크톱보다 큰 타입·큰 터치 타깃, 하단 3탭(예약/내 기록/마이), 쉬운 말 톤, 시간 12시간 표기(오후 2:30; 직원은 24시간 14:30). → 참조 목업 `mockups/key-patient-app.html`.

## Do's and Don'ts

| Do | Don't |
|---|---|
| **WCAG 2.1 AA 준수** — 본문/UI 텍스트 ≥ 4.5:1, 큰 텍스트(≥18.66px bold/24px)·비텍스트 UI ≥ 3:1 (surface/background 기준) | AA 미달 조합을 텍스트로 출고(흐린 회색·raw 앰버 등) |
| placeholder·가이드·보조 텍스트는 **`text-muted`**(5.89:1) | `text-disabled`(#607274)를 의미 있는 텍스트에 사용 |
| 앰버는 **채움/점**으로만 — 텍스트는 **`status-received-ink`**(5.75:1) | raw 앰버 `#BC7E12`를 텍스트/라벨로 사용(3.43:1) |
| primary는 채움/큰·굵은 텍스트로만 — 작은 텍스트·활성 내비는 **`primary-hover`**(6.62:1) | small teal 텍스트를 teal 틴트 위에(4.29:1) |
| 그린은 채움으로만 — 작은/틴트 위 텍스트는 **`status-done-ink`**(6.41:1) | 작은 그린 텍스트를 흰/틴트 위에(4.08–4.57:1) |
| 포커스 링 = **`#0A6675`** (흰 6.62:1 · 보더 5.14:1, 양쪽 ≥3:1) | 연한 링(구 `#2C9FB0`)으로 인접 보더와 구분 불가(2.43:1) |
| shadcn 기본값을 상속하고, 브랜드 델타만 override | 브랜드가 정당화 못 하는 토큰을 임의 override |
| teal(`{colors.primary}`)은 **액션/브랜드 전용** | teal을 상태색으로 사용(인디고와 충돌) |
| 상태는 **색 + 도형(○●◐✓✕)** 으로 중복 인코딩 | 색 하나에만 기대기(색약·저가 모니터 취약) |
| 중요 신호 = 색 채움 + 테두리 + 글자 굵기 | **음영/그림자만으로 의미 전달**(저가 모니터서 사라짐) |
| 영역은 **중요도 위계 + 헤어라인 + 톤 레이어링** 으로 분리 | 모든 섹션을 균일 카드 elevation으로 박싱(v2 거부됨) |
| 5상태 색을 결제·예약·급여구분에 일관 재사용 | 같은 의미에 다른 색을 새로 도입 |
| Pretendard 번들 + **윈도우 우선** 폴백 | 네트워크 폰트 의존 또는 맥 우선 스택 |
| 단축키 힌트는 `Ctrl` | `⌘` 표기(주 타깃 = 윈도우) |
| 약품·진단·수가는 마스터 **검색 피커** | 마스터 존재 영역에 free-text 입력 |
| 주민번호 기본 마스킹 + 권한 게이트 reveal + 감사 | raw 주민번호 노출·로그 |
| v1 = 라이트 전용으로 출시 | v1에 다크 모드 구현(판독실 수요 보고 추후 검토 — 보류) |
| `tabular-nums`로 숫자 정렬 | 가변폭 숫자로 표·금액 렌더 |
