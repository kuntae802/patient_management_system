// 환자 포털 도움말 콘텐츠(Story 9.8 / FR-252·253). 직원 도움말(help-content.ts)과 달리 환자 셸은
// STAFF_NAV·filterNav·권한 게이트가 없으므로, 고정된 4개 메뉴를 순서대로 들고 환자 전용 렌더러
// (patient-help-guide.tsx)가 모바일 단일 컬럼으로 그린다. 화면 데이터 모델(HelpScreen·HelpHotspot)과
// basePath helper(helpImageSrc)는 직원 쪽 단일 출처를 재사용한다. 번호(num)는 캡처 파이프라인
// (tools/screenshots/specs.mjs role:"patient")이 이미지에 구워 넣은 번호와 1:1.

import { type HelpScreen } from "@/lib/help/help-content";

/** 환자 도움말 한 메뉴 = 안정적 키 + 라벨 + 화면 목록(직원 HelpMenuGuide 의 환자 버전·href 키 없음). */
export type PatientHelpGuide = {
  /** 앵커·테스트용 안정 슬러그(예: "booking"). */
  key: string;
  /** 메뉴 이름(예: "예약"). */
  label: string;
  intro?: string;
  screens: HelpScreen[];
};

// 환자 캡처는 모바일 뷰포트(390×1000) — next/image 레이아웃 안정용 치수.
const PW = 390;
const PH = 1000;

export const PATIENT_HELP_GUIDES: PatientHelpGuide[] = [
  {
    key: "booking",
    label: "예약",
    intro:
      "진료과·의사·날짜·시간을 차례로 골라 예약합니다. 본인 진료기록이 연결돼 있어야 예약할 수 있어요(미연결이면 ‘본인 진료기록 연결’부터).",
    screens: [
      {
        title: "예약",
        image: "/help/patient/booking.png",
        imageWidth: PW,
        imageHeight: PH,
        alt: "환자 예약 화면 — 진료과·의사·날짜·시간 선택과 예약 확정 버튼",
        hotspots: [
          { num: 1, element: "진료과", desc: "진료받을 과를 고릅니다." },
          { num: 2, element: "의사", desc: "그 진료과의 의사를 고릅니다(진료과를 먼저 골라야 선택할 수 있어요)." },
          { num: 3, element: "날짜", desc: "예약할 날짜를 고릅니다(오늘부터 2주). 옆으로 넘겨 다른 날을 봅니다." },
          { num: 4, element: "시간", desc: "예약 가능한 시간을 고릅니다. 마감·휴진·지난 시간은 선택할 수 없어요." },
          { num: 5, element: "예약 확정하기", desc: "진료과·의사·날짜·시간을 모두 고르면 활성화됩니다. 누르면 예약이 확정돼요." },
        ],
        flow: "진료과 → 의사 → 날짜 → 시간을 차례로 고르고 ‘예약 확정하기’를 누릅니다. 예약 변경·취소는 마이 메뉴에서 합니다.",
      },
    ],
  },
  {
    key: "records",
    label: "내 진료기록",
    intro:
      "본인의 지난 진료 내역을 봅니다. 화면 상단 안내처럼 내 정보만 안전하게 보이고 다른 사람은 볼 수 없어요(본인 데이터만).",
    screens: [
      {
        title: "내 진료기록",
        image: "/help/patient/records.png",
        imageWidth: PW,
        imageHeight: PH,
        alt: "환자 내 진료기록 화면 — 신뢰 노트와 내원 카드, 처방·검사 펼침 토글",
        hotspots: [
          { num: 1, element: "지난 진료 내역", desc: "본인의 내원 이력을 최근순으로 봅니다(연도별 묶음·날짜·상태·의사·진단)." },
          { num: 2, element: "본인만 보임(안내)", desc: "내 정보만 안전하게 표시됩니다. 다른 사람은 볼 수 없어요." },
          { num: 3, element: "처방·검사 결과 보기", desc: "내원 카드를 펼쳐 그 진료의 처방·검사 결과를 봅니다." },
        ],
        flow: "보고 싶은 내원의 ‘처방·검사 결과 보기’를 눌러 펼칩니다. 본인 데이터만 보이며, 미연결이면 ‘본인 진료기록 연결’부터 합니다.",
      },
    ],
  },
  {
    key: "records-detail",
    label: "처방·검사 결과",
    intro:
      "내원을 펼치면 처방받은 약과 검사 결과 요약을 쉬운 말로 봅니다.",
    screens: [
      {
        title: "처방·검사 결과",
        image: "/help/patient/records-detail.png",
        imageWidth: PW,
        imageHeight: PH,
        alt: "환자 처방·검사 결과 — 처방받은 약 목록과 검사 결과 요약, 정상/주의 표시",
        hotspots: [
          { num: 1, element: "처방받은 약", desc: "약 이름·용량·복용법·며칠분인지 봅니다." },
          { num: 2, element: "검사 결과 요약", desc: "검사 결과를 쉬운 말로 요약해 보여줍니다." },
          { num: 3, element: "정상 / 주의", desc: "결과가 정상인지 주의가 필요한지 표시합니다. 자세한 수치·기록은 진료받은 의원에 보관돼요." },
        ],
        flow: "완료된 진료의 처방과 검사 결과를 쉬운 말로 봅니다. 영상 원본·상세 수치는 진료받은 의원·의료진 상담에서 확인합니다.",
      },
    ],
  },
  {
    key: "payments",
    label: "수납·영수증",
    intro:
      "결제를 마친 진료의 수납 내역(마이)과 영수증을 봅니다. 본인 결제 내역만 보여요.",
    screens: [
      {
        title: "수납 (마이)",
        image: "/help/patient/payments.png",
        imageWidth: PW,
        imageHeight: PH,
        alt: "환자 마이 화면 — 신뢰 노트와 결제 완료 수납 카드",
        hotspots: [
          { num: 1, element: "본인만 보임(안내)", desc: "내 결제 내역만 안전하게 표시됩니다. 다른 사람은 볼 수 없어요." },
          { num: 2, element: "수납 카드", desc: "결제를 마친 진료의 날짜·요양기관·진료과·납부액입니다. 누르면 영수증으로 갑니다." },
          { num: 3, element: "완료", desc: "결제가 완료된 건임을 표시합니다." },
        ],
        flow: "수납 카드를 누르면 그 진료의 영수증으로 이동합니다. 마이 화면에는 결제 완료 건만 보입니다.",
      },
      {
        title: "영수증",
        image: "/help/patient/receipt.png",
        imageWidth: PW,
        imageHeight: PH,
        alt: "환자 영수증 화면 — 진료 항목, 내가 낸 금액, 영수증 인쇄·저장 버튼",
        hotspots: [
          { num: 1, element: "진료 항목", desc: "진료 내용을 항목 분류별로 보여줍니다." },
          { num: 2, element: "내가 낸 금액", desc: "총 진료비에서 건강보험 부담을 뺀, 본인이 실제로 낸 금액입니다(강조)." },
          { num: 3, element: "영수증 인쇄·저장", desc: "「국민건강보험법」 서식의 진료비 계산서·영수증을 인쇄하거나 PDF로 저장합니다." },
        ],
        flow: "화면은 쉬운 말 요약으로, 인쇄·저장은 법정 서식으로 나옵니다. 본인 finalized(결제 완료) 진료만 볼 수 있어요.",
      },
    ],
  },
];
