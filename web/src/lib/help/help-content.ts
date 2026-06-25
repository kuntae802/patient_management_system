// 도움말 콘텐츠 데이터 모델(Story 9.1 / FR-252·253).
// 키 = staff-nav 의 href(단일 출처) — 페이지는 filterNav 결과를 이 맵에 매핑해 현재 계정 메뉴만 렌더한다.
// 화면의 번호 하이라이트(①②③…)는 캡처 파이프라인(Story 9.2)이 이미지에 구워 넣는다 — 여기서는
// 좌표 오버레이가 아니라 "번호 ↔ 설명" 표(hotspots)만 들고, 페이지가 이미지와 나란히 보여준다.

/** 한 화면 안의 번호가 매겨진 동작 요소(이미지에 구워진 번호와 1:1). */
export type HelpHotspot = {
  /** 이미지에 표시된 번호(1=①, 2=②, …). */
  num: number;
  /** 요소 이름(예: "진료 시작"). */
  element: string;
  /** 무엇을·어떻게 하는지 설명. */
  desc: string;
};

/** 메뉴 안내를 구성하는 한 장의 화면(스크린샷 + 번호표 + 작업 흐름). */
export type HelpScreen = {
  title: string;
  /** basePath 없는 앱-내 절대경로(예: "/help/doctor/waiting.png"). next/image 가 basePath 를 자동 전파. */
  image: string;
  /** 원본 캡처 픽셀 크기(next/image 레이아웃 안정용). */
  imageWidth: number;
  imageHeight: number;
  alt: string;
  hotspots: HelpHotspot[];
  /** 화면 사용 흐름 서술(선택). */
  flow?: string;
};

/** 한 메뉴(href)에 대한 안내 = 도입부 + 화면 목록. */
export type HelpMenuGuide = {
  /** staff-nav NavItem.href 와 동일(매핑 키). */
  href: string;
  intro?: string;
  screens: HelpScreen[];
};

// 메뉴 href → 앵커 슬러그. 인덱스 링크(#slug)와 본문 섹션 id 를 한 곳에서 생성해 불일치를 원천 차단한다.
// 예: "/reception/billing/history" → "help-reception-billing-history".
export function helpHrefSlug(href: string): string {
  return `help-${href.replace(/^\/+/, "").replace(/\//g, "-")}`;
}

// ⚠️ basePath 함정: next/image 는 src 가 "/" 로 시작하는 internal 경로일 때 basePath 를 제대로 붙이지 않는다
// (최적화 url 파라미터에 basePath 누락 → optimizer 가 /help/... 를 못 찾아 400). next.config 와 동일한
// 폴백으로 basePath 를 직접 부여해, optimizer 의 internal fetch 가 public 자산(/<base>/help/...)을 가리키게 한다.
const HELP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/patient_management_system";

/** 도움말 이미지(앱-내 절대경로)에 basePath 를 부여한 next/image src. */
export function helpImageSrc(image: string): string {
  return `${HELP_BASE_PATH}${image}`;
}

// 메뉴별 도움말 콘텐츠. 9.1 = 의사 진료 대기(→ 진료 허브 흐름)만 시범 이식(docs/submission/help-storyboard/9-2-의사.md 원형).
// 나머지 메뉴는 키 미존재 = 페이지에서 "준비 중" 플레이스홀더. 원무/의사 판독/간호/방사선사/관리자/환자는 Story 9.3~9.8 이 채운다.
export const HELP_GUIDES: Record<string, HelpMenuGuide> = {
  "/doctor/waiting": {
    href: "/doctor/waiting",
    intro:
      "진료 대기에서 환자를 받아 진료 허브로 들어갑니다. 허브에서 활력·과거 이력을 확인하고 SOAP 기록·진단 부착·오더(처방/영상/처치)를 합니다. 진료 완료(내원 종결)는 원무 수납이 결제를 마치면 자동으로 처리되므로, 의사가 완료 버튼을 누르지 않습니다.",
    screens: [
      {
        title: "진료 대기",
        image: "/help/doctor/waiting.png",
        imageWidth: 1440,
        imageHeight: 900,
        alt: "의사 진료 대기 화면 — 다음 진료 배너와 대기 목록",
        hotspots: [
          { num: 1, element: "진료 대기 메뉴", desc: "로그인하면 처음 보이는 화면입니다(역할별 홈)." },
          { num: 2, element: "진료과", desc: "의사는 본인 진료과로 고정되며 다른 과로 바꿀 수 없습니다." },
          { num: 3, element: "진료 시작", desc: "“다음 진료” 배너에서 가장 먼저 볼 대기 환자의 진찰을 시작합니다." },
          { num: 4, element: "진료 계속", desc: "진행 중(in_progress)인 내원을 이어서 봅니다." },
        ],
        flow: "상단 “다음 진료” 배너가 다음에 볼 환자를 안내합니다. ③으로 접수 환자의 진찰을 시작하거나 ④로 진행 중 내원을 이어 열어 진료 허브로 들어갑니다. 목록은 진행 중 → 접수 → 완료 순으로 묶여 활성도·호출·대기시간 순으로 정렬할 수 있습니다.",
      },
      {
        title: "진료 허브",
        image: "/help/doctor/hub.png",
        imageWidth: 1440,
        imageHeight: 900,
        alt: "의사 진료 허브 화면 — 활력·진단·SOAP·오더 패널",
        hotspots: [
          { num: 1, element: "내원 헤더", desc: "내원 번호·상태(진행 중)·진료 시작 시각을 보여줍니다." },
          { num: 2, element: "주민번호 표시", desc: "기본은 마스킹(951203-1******)이며, “표시”를 누르면 감사 기록을 남긴 뒤 잠시 노출됩니다." },
          { num: 3, element: "활력징후", desc: "간호가 미리 입력한 혈압·맥박·체온·호흡·SpO₂를 확인합니다." },
          { num: 4, element: "진단(KCD)", desc: "진단 코드·명칭을 검색해 부착하고 주/부상병을 구분합니다." },
          { num: 5, element: "진료 기록(SOAP)", desc: "주관적·객관적·평가·계획을 작성하며, 변경 시 자동 저장됩니다." },
          { num: 6, element: "오더 패널", desc: "처방·영상·처치 탭에서 지시하며, 아직 수행되지 않은 오더는 취소할 수 있습니다." },
        ],
        flow: "좌측에서 활력·임상 프로필·과거 이력을 확인하고, 중앙에서 SOAP를 작성하며 진단을 부착합니다(주상병이 없으면 완료할 수 없습니다). 우측 오더 패널에서 처방·영상·처치를 지시합니다(약품·행위는 마스터에서만 선택). 진료가 끝나면 “진료 대기로” 돌아가고, 이후 원무 수납에서 결제하면 내원이 자동으로 완료됩니다.",
      },
    ],
  },

  // ── 의사 판독(doctor) — Story 9.4. 번호는 캡처 스펙 doctor/radiology 와 1:1. ──
  "/doctor/radiology": {
    href: "/doctor/radiology",
    intro:
      "방사선사가 촬영을 수행한 영상검사가 “판독 대기”로 올라옵니다. 의사가 영상을 보고 판독 소견·결론을 기록하면 검사 오더가 완료됩니다(판독 겸임).",
    screens: [
      {
        title: "판독 워크리스트",
        image: "/help/doctor/radiology.png",
        imageWidth: 1440,
        imageHeight: 900,
        alt: "의사 판독 워크리스트 화면 — 판독 대기 목록과 소견·결론 입력",
        hotspots: [
          { num: 1, element: "판독 대기 영상검사", desc: "촬영 수행된 미판독 영상검사 목록입니다. 항목을 선택하면 우측에서 판독합니다. 오래 밀리면 “판독 지연” 배지가 붙습니다." },
          { num: 2, element: "판독 소견", desc: "영상을 보고 판독 소견을 적습니다(필수). 비어 있으면 완료할 수 없습니다." },
          { num: 3, element: "판독 결론", desc: "결론·임프레션을 적습니다(선택)." },
          { num: 4, element: "판독 완료", desc: "소견을 입력하면 활성화됩니다. 누르면 검사 오더가 완료(판독 종결)되고 목록에서 빠집니다." },
        ],
        flow: "좌측 판독 대기 목록에서 검사를 선택하면 우측에 촬영 영상과 입력란이 나타납니다 → 판독 소견(필수)·결론(선택)을 적고 → “판독 완료”를 누르면 검사 오더가 종결됩니다. 영상 업로드·촬영 수행은 방사선사 몫입니다.",
      },
    ],
  },

  // ── 원무(reception) — Story 9.3. 번호는 캡처 스펙(tools/screenshots/specs.mjs)의 reception 엔트리와 1:1. ──
  "/reception/waiting": {
    href: "/reception/waiting",
    intro:
      "로그인하면 처음 보이는 화면입니다. 오늘 접수된 환자를 상태별(접수·진행중·완료)로 한눈에 보고, 다음 차례 환자를 호출합니다. 접수 → 대기 → 호출이 원무의 기본 흐름입니다.",
    screens: [
      {
        title: "대기 현황",
        image: "/help/reception/waiting.png",
        imageWidth: 1440,
        imageHeight: 900,
        alt: "원무 대기 현황 화면 — 다음 호출 배너와 상태별 대기 목록",
        hotspots: [
          { num: 1, element: "진료과 필터", desc: "보고 싶은 진료과만 고르거나 “전체 진료과”로 둡니다. 기본은 전체입니다." },
          { num: 2, element: "날짜 이동", desc: "어제·내일의 대기 현황으로 옮깁니다. 기본은 오늘입니다." },
          { num: 3, element: "새로고침", desc: "실시간 갱신과 별개로 지금 바로 다시 불러옵니다." },
          { num: 4, element: "다음 호출", desc: "가장 먼저 부를 환자입니다. “호출”을 누르면 그 환자를 부릅니다." },
          { num: 5, element: "호출(행별)", desc: "대기 목록의 환자를 개별로 호출하거나 다시 호출합니다." },
        ],
        flow: "접수에서 등록한 환자가 여기에 “접수” 상태로 나타납니다 → “호출”로 부르면 환자가 진료실로 오고 → 의사가 진료를 시작합니다. 목록은 활성도·호출·대기시간 순으로 정렬할 수 있습니다.",
      },
    ],
  },
  "/reception/intake": {
    href: "/reception/intake",
    intro:
      "예약 없이 방문한(walk-in) 환자를 즉석에서 접수해 대기열에 올립니다. 검색 → 환자 선택 → 진료과 선택 → 접수 순서입니다.",
    screens: [
      {
        title: "접수",
        image: "/help/reception/intake.png",
        imageWidth: 1440,
        imageHeight: 900,
        alt: "원무 접수 화면 — 환자 선택과 진료과 지정",
        hotspots: [
          { num: 1, element: "환자(검색·선택)", desc: "환자 이름·차트번호·연락처로 검색해 환자를 고릅니다. 다른 환자면 “변경”으로 다시 검색하세요." },
          { num: 2, element: "진료과", desc: "접수할 진료과를 고릅니다(필수)." },
          { num: 3, element: "접수", desc: "내원을 만들고 대기열에 올립니다. 환자·진료과를 둘 다 고르면 활성화됩니다." },
        ],
        flow: "접수하면 곧바로 대기 현황 화면에 “접수” 상태로 나타납니다 — 접수 → 대기 → 호출 흐름의 시작점입니다.",
      },
    ],
  },
  "/reception/schedule": {
    href: "/reception/schedule",
    intro:
      "진료과·날짜를 골라 의사별 시간표를 보고, 빈 슬롯을 클릭해 예약을 잡습니다.",
    screens: [
      {
        title: "예약 관리",
        image: "/help/reception/schedule.png",
        imageWidth: 1440,
        imageHeight: 900,
        alt: "원무 예약 관리 화면 — 의사별 일 시간표와 예약 슬롯",
        hotspots: [
          { num: 1, element: "진료과", desc: "일정을 볼 진료과를 고릅니다. 진료과를 선택해야 시간표가 나타납니다." },
          { num: 2, element: "날짜", desc: "조회할 날짜입니다. 기본은 오늘입니다." },
          { num: 3, element: "예약 캘린더", desc: "의사별 시간표입니다. 빈(예약 가능) 슬롯을 클릭하면 예약을 만들 수 있습니다. 색·글리프로 가능·확정·완료·휴진·지난시간을 구분합니다." },
        ],
        flow: "진료과·날짜를 고르면 시간표가 나옵니다 → 빈 슬롯 클릭으로 예약 생성 → 확정된 예약은 환자 도착 시 접수로 이어집니다. 더블부킹은 자동 차단됩니다.",
      },
    ],
  },
  "/reception/reminders": {
    href: "/reception/reminders",
    intro:
      "예약 3일 전·1일 전, SMS 수신에 동의한 예약에 리마인더를 발송(시뮬레이션)하고 그 이력을 확인합니다.",
    screens: [
      {
        title: "리마인더",
        image: "/help/reception/reminders.png",
        imageWidth: 1440,
        imageHeight: 900,
        alt: "원무 리마인더 화면 — 발송 실행과 발송 이력 표",
        hotspots: [
          { num: 1, element: "기준일(선택)", desc: "“오늘로 가정할 날짜”입니다. 비워두면 오늘 기준이며, 이 날의 3일 후·1일 후 예약에 발송합니다." },
          { num: 2, element: "리마인더 실행", desc: "대상 예약에 SMS 리마인더를 발송(시뮬)하고 이력을 남깁니다. 같은 예약에 중복 발송하지 않습니다." },
          { num: 3, element: "발송 이력", desc: "발송 시각·종류(3일 전/1일 전)·예약 시각·수신처(마스킹)·상태가 표로 쌓입니다." },
        ],
        flow: "실 SMS는 연동되어 있지 않아 발송은 시뮬레이션으로 처리되고 이력만 남습니다. 수신처는 개인정보 보호를 위해 마스킹되어 표시됩니다.",
      },
    ],
  },
  "/reception/register": {
    href: "/reception/register",
    intro:
      "앱을 쓰지 않는 환자(전화·방문·고령자)의 레코드를 원무가 직접 만들고 차트번호를 부여합니다.",
    screens: [
      {
        title: "환자 등록",
        image: "/help/reception/register.png",
        imageWidth: 1440,
        imageHeight: 900,
        alt: "원무 환자 등록 화면 — 신원·보험·연락처 입력 폼",
        hotspots: [
          { num: 1, element: "이름", desc: "환자 실명입니다(필수)." },
          { num: 2, element: "주민등록번호", desc: "신원 확인·암호화 저장에 쓰입니다(필수). 저장 후에는 마스킹된 형태로만 보입니다." },
          { num: 3, element: "보험유형", desc: "본인부담률 산정의 근거입니다(필수)." },
          { num: 4, element: "휴대전화(선택)", desc: "연락·환자 앱 연결의 단서입니다." },
          { num: 5, element: "환자 등록", desc: "레코드를 만들고 차트번호를 부여합니다." },
        ],
        flow: "주민등록번호는 암호화되어 저장되고 화면에는 항상 마스킹만 보입니다(원무 화면에는 평문으로 보는 기능이 없습니다).",
      },
    ],
  },
  "/patients": {
    href: "/patients",
    intro:
      "이름·차트번호·연락처로 환자를 찾아 상세로 이동합니다. 전역 단축키 Ctrl K로도 같은 검색을 쓸 수 있습니다.",
    screens: [
      {
        title: "환자 검색",
        image: "/help/reception/patients.png",
        imageWidth: 1440,
        imageHeight: 900,
        alt: "원무 환자 검색 화면 — 검색 결과 목록",
        hotspots: [
          { num: 1, element: "검색박스", desc: "이름·차트번호·연락처를 입력해 검색합니다(입력해야 결과가 나옵니다)." },
          { num: 2, element: "검색 상태", desc: "찾은 결과 수를 알려줍니다." },
          { num: 3, element: "결과 행", desc: "클릭하면 환자 상세로 이동합니다. 생년월일·성별·마스킹 주민번호·연락처로 동명이인을 구분합니다." },
        ],
        flow: "주민등록번호는 마스킹된 형태로만 보입니다 — 동명이인 식별을 돕되 평문은 노출하지 않습니다.",
      },
    ],
  },
  "/reception/billing": {
    href: "/reception/billing",
    intro:
      "수납은 두 단계입니다. (1) 수납 대상 목록에서 내원을 고르고, (2) 자동 산정된 수가를 확인해 결제합니다. 진찰 중인 내원은 “정산”, 접수만 된 내원은 “선수납” 대상입니다.",
    screens: [
      {
        title: "수납 대상 목록",
        image: "/help/reception/billing.png",
        imageWidth: 1440,
        imageHeight: 900,
        alt: "원무 수납 워크리스트 — 정산·선수납 대상 내원 목록",
        hotspots: [
          { num: 1, element: "수납 대상 내원", desc: "오늘 수납할 내원 목록입니다." },
          { num: 2, element: "정산 대상(진찰중)", desc: "진료가 진행 중인 내원입니다. 클릭하면 집계·결제 화면으로 들어갑니다. 예상 총액이 함께 보입니다." },
          { num: 3, element: "선수납 가능(접수)", desc: "접수만 된 내원입니다. 진료 전 미리 받는 선수납을 할 수 있습니다(예상 0원)." },
        ],
        flow: "정산은 “진찰중” 행, 선수납은 “접수” 행을 클릭해 상세로 들어갑니다.",
      },
      {
        title: "수납 상세 · 결제",
        image: "/help/reception/billing-detail.png",
        imageWidth: 1440,
        imageHeight: 900,
        alt: "원무 수납 상세 화면 — 집계·본인부담 산정·결제",
        hotspots: [
          { num: 1, element: "본인부담금(환자 청구)", desc: "환자가 낼 금액입니다(보험유형 기준 자동 산정)." },
          { num: 2, element: "금액 분해", desc: "수납 집계를 총 진료비·급여·비급여·공단부담금으로 나눠 보여줍니다." },
          { num: 3, element: "결제 수단", desc: "카드·현금·계좌이체 중에서 고릅니다." },
          { num: 4, element: "결제·내원 완료", desc: "본인부담금을 결제하고 내원을 완료합니다. 완료 후에는 취소할 수 없습니다." },
        ],
        flow: "수가는 자동으로 산정됩니다 → 결제 수단을 고르고 “결제·내원 완료”를 누르면 정산이 끝납니다(접수 상태면 “선결제”로 미리 받을 수 있습니다). 완료 후에는 진료비 계산서·영수증·세부산정내역서·원외처방전을 출력할 수 있고, 지난 영수증은 “수납 내역”에서 다시 출력합니다.",
      },
    ],
  },
  "/reception/billing/history": {
    href: "/reception/billing/history",
    intro:
      "완료된(정산된) 수납을 환자명·차트번호·영수증번호·기간으로 검색해 영수증을 다시 출력합니다.",
    screens: [
      {
        title: "수납 내역",
        image: "/help/reception/history.png",
        imageWidth: 1440,
        imageHeight: 900,
        alt: "원무 수납 내역 화면 — 완료된 수납 목록과 영수증 재출력",
        hotspots: [
          { num: 1, element: "통합 검색", desc: "환자명·차트번호·영수증번호로 지난 수납을 찾습니다." },
          { num: 2, element: "기간 필터", desc: "정산일 기준으로 시작일·종료일을 정해 기간을 좁힙니다." },
          { num: 3, element: "결과 표", desc: "완료된 수납이 영수증번호·환자·진료과·본인부담·정산일시로 나옵니다." },
          { num: 4, element: "영수증 보기", desc: "상세로 이동해 영수증·세부산정내역서·원외처방전을 다시 출력합니다(재출력)." },
        ],
        flow: "수납 → 영수증·재출력: 결제를 마친 수납이 여기 쌓이고, “영수증 보기”로 상세에 들어가 문서를 다시 인쇄합니다.",
      },
    ],
  },
};
