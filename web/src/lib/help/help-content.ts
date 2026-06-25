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
};
