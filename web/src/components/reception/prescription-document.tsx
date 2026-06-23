import { formatKstDate } from "@/lib/billing/format";
import type {
  PrescriptionDocItem,
  PrescriptionDocument,
} from "@/lib/billing/prescriptions";
import { insuranceLabel } from "@/lib/reception/patients";

// 원외처방전 법정 서식(Story 7.7 / FR-115·FR-050 · UX-DR14 · UX-DR22). 「국민건강보험법 시행규칙」 별지
// 제9호 서식(처방전) 풍 — Batang serif(legal-serif 예외·.receipt-paper 재사용 = @media print 타깃·CSS 0)·
// 흰 종이·검은 잉크·하드 보더. 한 처방(1매)을 렌더 — 요양기관·환자(masked RRN)·질병분류기호(KCD)·처방
// 의약품 표(명칭·1회량·1일횟수·총일수·용법)·처방 의료인 면허·서명. 약가 없음(원외처방전 = 약품 목록만).
// 데이터는 전부 DB 조립값(prescription.dispense 게이트) — 클라는 표시만. 주민번호 masked(full reveal 이월).

/** 면허종류 한글 라벨(0002 users.license_type CHECK 거울). */
const LICENSE_TYPE_LABEL: Record<string, string> = {
  doctor: "의사",
  radiologist: "방사선사",
};

/** 성별 한글 라벨(patients.sex CHECK 거울). */
const SEX_LABEL: Record<string, string> = {
  male: "남",
  female: "여",
};

/** 1회 투약량 표시 — dose + 단위(예 "1 정"). dose null → "—". */
function doseLabel(dose: number | null, unit: string | null): string {
  if (dose == null) return "—";
  return unit ? `${dose} ${unit}` : `${dose}`;
}

/** 발급번호(교부번호) — 처방 식별자 기반 파생 표시(저장 시퀀스 이월·불투명·PII 없음). */
function issueNo(prescriptionId: string): string {
  return `RX-${prescriptionId.slice(0, 8).toUpperCase()}`;
}

export function PrescriptionDocument({
  data,
  prescription,
}: {
  data: PrescriptionDocument;
  prescription: PrescriptionDocItem;
}) {
  const { clinic, patient, encounter } = data;
  const insurance = insuranceLabel(patient.insurance_type);
  const sex = patient.sex ? (SEX_LABEL[patient.sex] ?? patient.sex) : "—";
  const licenseLabel = prescription.prescriber.license_type
    ? (LICENSE_TYPE_LABEL[prescription.prescriber.license_type] ??
      prescription.prescriber.license_type)
    : "—";

  return (
    <div className="receipt-paper mx-auto max-w-[820px] bg-white p-8 font-legal-serif text-[13px] text-black">
      {/* 문서 제목 */}
      <div className="border-b-2 border-black pb-2 text-center">
        <h1 className="text-[20px] font-bold tracking-wide">
          원외처방전
          <span className="ml-2 align-middle text-[11px] font-normal text-neutral-600">
            OUTPATIENT PRESCRIPTION
          </span>
        </h1>
        <div className="mt-1 flex items-center justify-between text-[12px]">
          <span>[ 외래 ]</span>
          <span className="tabular-nums">
            교부번호 : {issueNo(prescription.id)}
          </span>
        </div>
      </div>

      {/* 요양기관 헤더 */}
      <div className="mt-3 flex items-start justify-between">
        <div>
          <div className="text-[15px] font-bold">{clinic.name}</div>
          <div className="mt-0.5 text-[11.5px] leading-relaxed">
            사업자등록번호 <span className="tabular-nums">{clinic.biz_no}</span>{" "}
            · 요양기관기호{" "}
            <span className="tabular-nums">{clinic.hira_no}</span>
            <br />
            {clinic.address} · 대표자 {clinic.ceo_name}
            <br />
            전화 <span className="tabular-nums">{clinic.phone}</span>
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
            <td className="w-[32%] border border-black px-2 py-1">
              {patient.name}
            </td>
            <th className="w-[18%] border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              차트번호
            </th>
            <td className="w-[32%] border border-black px-2 py-1 tabular-nums">
              {patient.chart_no}
            </td>
          </tr>
          <tr>
            <th className="border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              주민등록번호
            </th>
            <td className="border border-black px-2 py-1 tabular-nums">
              {patient.resident_no_masked}
            </td>
            <th className="border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              생년월일 · 성별
            </th>
            <td className="border border-black px-2 py-1 tabular-nums">
              {formatKstDate(patient.birth_date)} · {sex}
            </td>
          </tr>
          <tr>
            <th className="border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              질병분류기호
            </th>
            <td className="border border-black px-2 py-1 tabular-nums">
              {prescription.diagnosis
                ? `${prescription.diagnosis.code} (${prescription.diagnosis.name})`
                : "—"}
            </td>
            <th className="border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              진료과 · 환자구분
            </th>
            <td className="border border-black px-2 py-1">
              {encounter.department_name} · {insurance}
            </td>
          </tr>
        </tbody>
      </table>

      {/* 처방 의약품 (FR-050: 명칭·1회 투약량·1일 투여횟수·총 투여일수·용법) */}
      <div className="mt-4 mb-1 text-[12px] font-bold">처방 의약품</div>
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="border border-black bg-neutral-100 px-2 py-1 text-left">
              처방 의약품의 명칭
            </th>
            <th className="border border-black bg-neutral-100 px-2 py-1">
              1회 투약량
            </th>
            <th className="border border-black bg-neutral-100 px-2 py-1">
              1일 투여횟수
            </th>
            <th className="border border-black bg-neutral-100 px-2 py-1">
              총 투여일수
            </th>
            <th className="border border-black bg-neutral-100 px-2 py-1 text-left">
              용법
            </th>
          </tr>
        </thead>
        <tbody>
          {prescription.drugs.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="border border-black px-2 py-3 text-center text-neutral-500"
              >
                처방 의약품이 없습니다.
              </td>
            </tr>
          ) : (
            prescription.drugs.map((drug, i) => (
              <tr key={`${drug.drug_code}-${i}`}>
                <td className="border border-black px-2 py-1">
                  {drug.drug_name}
                  <span className="ml-1 text-[10.5px] text-neutral-500 tabular-nums">
                    {drug.drug_code}
                  </span>
                </td>
                <td className="border border-black px-2 py-1 text-center tabular-nums">
                  {doseLabel(drug.dose, drug.drug_unit)}
                </td>
                <td className="border border-black px-2 py-1 text-center">
                  {drug.frequency ?? "—"}
                </td>
                <td className="border border-black px-2 py-1 text-center tabular-nums">
                  {drug.duration_days != null ? `${drug.duration_days}일` : "—"}
                </td>
                <td className="border border-black px-2 py-1">
                  {drug.usage_instruction ?? "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* 사용기간 */}
      <div className="mt-3 text-[11.5px]">
        사용기간 : 교부일로부터 <span className="font-medium">3일</span>{" "}
        (사용기간 내 약국 제출)
      </div>

      {/* 처방 의료인 + 발행/발급 + 서명 */}
      <div className="mt-5 flex items-end justify-between text-[12px]">
        <div className="leading-relaxed">
          발행일자 :{" "}
          <span className="tabular-nums">
            {formatKstDate(prescription.ordered_at)}
          </span>
          <br />
          발급일자 :{" "}
          <span className="tabular-nums">
            {prescription.dispensed_at
              ? formatKstDate(prescription.dispensed_at)
              : "미발급"}
          </span>
        </div>
        <div className="text-right leading-relaxed">
          처방 의료인 :{" "}
          <span className="font-bold">
            {prescription.prescriber.name ?? "—"}
          </span>{" "}
          <span className="text-[10.5px] text-neutral-500">
            (서명 또는 날인)
          </span>
          <br />
          {licenseLabel} 면허번호{" "}
          <span className="tabular-nums">
            {prescription.prescriber.license_no ?? "—"}
          </span>
        </div>
      </div>

      {/* 법적 고지 */}
      <div className="mt-4 border-t border-neutral-300 pt-2 text-[10.5px] leading-relaxed text-neutral-600">
        본 처방전은 「국민건강보험법 시행규칙」에 따른 원외처방전으로, 원외
        약국에서 조제·투약받기 위한 서식입니다. 약사는 처방 의약품을 사용기간
        내에 조제하며, 대체조제 시 관련 법령을 따릅니다.
      </div>
    </div>
  );
}
