import type { ReactNode } from "react";

import { formatKrw } from "@/lib/admin/masters";
import { formatKstDate } from "@/lib/billing/format";
import type { Receipt } from "@/lib/billing/payments";
import { insuranceLabel } from "@/lib/reception/patients";

// 진료비 법정 문서(영수증 7.5·세부산정내역서 7.6) 공용 골격. 「국민건강보험법 시행규칙」 별지 서식 풍 —
// Batang serif(legal-serif 예외)·흰 종이·검은 잉크·하드 보더(앱 미학과 의도적 대비). 문서 제목 바·요양기관
// 헤더·환자 정보 테이블·발급/서명·법적 고지를 두 문서가 공유한다(중복 제거·일관성). 주민번호 = masked 만.

/** 금액 셀(우정렬·tabular-nums·검은 잉크). */
export function Won({ amount }: { amount: number }) {
  return <span className="tabular-nums">{formatKrw(amount)}</span>;
}

/** 문서 제목 바 + 요양기관 헤더 + 환자 정보 테이블(영수증·세부내역서 공용). 제목/영문 부제만 다름. */
export function LegalDocumentHeader({
  data,
  title,
  subtitleEn,
}: {
  data: Receipt;
  title: string;
  subtitleEn: string;
}) {
  const insurance = insuranceLabel(data.patient.insurance_type);
  const period =
    data.encounter.treatment_started_on === data.encounter.treatment_ended_on
      ? formatKstDate(data.encounter.treatment_started_on)
      : `${formatKstDate(data.encounter.treatment_started_on)} ~ ${formatKstDate(
          data.encounter.treatment_ended_on,
        )}`;

  return (
    <>
      {/* 문서 제목 */}
      <div className="border-b-2 border-black pb-2 text-center">
        <h1 className="text-[20px] font-bold tracking-wide">
          {title}
          <span className="ml-2 align-middle text-[11px] font-normal text-neutral-600">
            {subtitleEn}
          </span>
        </h1>
        <div className="mt-1 flex items-center justify-between text-[12px]">
          <span>[ 외래 ]</span>
          <span className="tabular-nums">영수증 번호 : {data.payment_no ?? "—"}</span>
        </div>
      </div>

      {/* 요양기관 헤더 */}
      <div className="mt-3 flex items-start justify-between">
        <div>
          <div className="text-[15px] font-bold">{data.clinic.name}</div>
          <div className="mt-0.5 text-[11.5px] leading-relaxed">
            사업자등록번호 <span className="tabular-nums">{data.clinic.biz_no}</span> · 요양기관기호{" "}
            <span className="tabular-nums">{data.clinic.hira_no}</span>
            <br />
            {data.clinic.address} · 대표자 {data.clinic.ceo_name}
            <br />
            전화 <span className="tabular-nums">{data.clinic.phone}</span>
          </div>
        </div>
        <div className="flex size-14 shrink-0 items-center justify-center border border-dashed border-neutral-400 text-center text-[10px] leading-tight text-neutral-500">
          의료기관
          <br />
          직인
        </div>
      </div>

      {/* 환자 정보 */}
      <div className="mt-4 mb-1 text-[12px] font-bold">환자 정보</div>
      <table className="w-full border-collapse text-[12px]">
        <tbody>
          <tr>
            <th className="w-[18%] border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              환자 성명
            </th>
            <td className="w-[32%] border border-black px-2 py-1">{data.patient.name}</td>
            <th className="w-[18%] border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              차트번호
            </th>
            <td className="w-[32%] border border-black px-2 py-1 tabular-nums">
              {data.patient.chart_no}
            </td>
          </tr>
          <tr>
            <th className="border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              주민등록번호
            </th>
            <td className="border border-black px-2 py-1 tabular-nums">
              {data.patient.resident_no_masked}
            </td>
            <th className="border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              진료과 · 담당의
            </th>
            <td className="border border-black px-2 py-1">
              {data.encounter.department_name}
              {data.encounter.doctor_name ? ` · ${data.encounter.doctor_name}` : ""}
            </td>
          </tr>
          <tr>
            <th className="border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              진료기간
            </th>
            <td className="border border-black px-2 py-1 tabular-nums">{period}</td>
            <th className="border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              환자구분
            </th>
            <td className="border border-black px-2 py-1">{insurance}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

/** 발급/서명 블록 + 법적 고지(영수증·세부내역서 공용). 법적 고지 문구만 문서별로 다름(legalNote). */
export function LegalDocumentFooter({
  data,
  legalNote,
}: {
  data: Receipt;
  legalNote: ReactNode;
}) {
  return (
    <>
      {/* 발급 / 서명 */}
      <div className="mt-5 flex items-end justify-between text-[12px]">
        <div className="leading-relaxed">
          발급일자 : <span className="tabular-nums">{formatKstDate(data.finalized_at)}</span>
          <br />
          발급담당 : <span>{data.issued_by_name ?? "—"}</span>
        </div>
        <div className="text-right leading-relaxed">
          위 금액을 청구합니다.
          <br />
          <span className="font-bold">{data.clinic.name}</span>{" "}
          <span className="text-[10px] text-neutral-500">(직인생략)</span>
        </div>
      </div>

      {/* 법적 고지 */}
      <div className="mt-4 border-t border-neutral-300 pt-2 text-[10.5px] leading-relaxed text-neutral-600">
        {legalNote}
      </div>
    </>
  );
}
