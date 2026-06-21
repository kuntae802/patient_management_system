import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import {
  bloodTypeLabel,
  type ClinicalProfileValues,
  clinicalProfileSchema,
  normalizeRrn,
  patientCreateSchema,
  type PatientListItem,
  rrnChecksumOk,
  rrnHardError,
  searchPatients,
  toClinicalProfilePayload,
  toPatientCreatePayload,
  type PatientCreateValues,
} from "./patients";

// 검색은 apiFetch 만 호출 — 모킹(순수함수 테스트는 미사용이라 영향 없음).
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);
afterEach(() => vi.clearAllMocks());

// 클라 1선 주민번호 검증(services/rrn 의 거울) + 페이로드 변환. 3중 검증의 즉시 UX 레이어.

describe("normalizeRrn", () => {
  it("하이픈·공백 제거 → 13자리 숫자", () => {
    expect(normalizeRrn("900101-1234567")).toBe("9001011234567");
    expect(normalizeRrn(" 900101 1234567 ")).toBe("9001011234567");
  });
});

describe("rrnHardError (HARD — 차단)", () => {
  it("유효 주민번호 → null(통과)", () => {
    expect(rrnHardError("900101-1234567")).toBeNull();
    expect(rrnHardError("9001011234567")).toBeNull(); // 하이픈 없어도 통과
  });

  it("길이 미달 → 메시지", () => {
    expect(rrnHardError("123")).toMatch(/13자리/);
  });

  it("성별·세기 자리(9·0) → 메시지", () => {
    expect(rrnHardError("900101-9234567")).toMatch(/성별/);
    expect(rrnHardError("900101-0234567")).toMatch(/성별/);
  });

  it("생년월일(13월·32일) → 메시지", () => {
    expect(rrnHardError("901301-1234567")).toMatch(/생년월일/);
    expect(rrnHardError("900132-1234567")).toMatch(/생년월일/);
  });

  it("2000년대(성별자리 3·4) 윤년 2/29 → 통과", () => {
    // 2000-02-29 실재(윤년) — 성별자리 3 = 2000년대.
    expect(rrnHardError("000229-3234567")).toBeNull();
  });

  it("외국인(성별자리 5–8) 허용", () => {
    expect(rrnHardError("900101-5234567")).toBeNull();
    expect(rrnHardError("000101-7234567")).toBeNull();
  });
});

describe("rrnChecksumOk (SOFT — 경고만)", () => {
  it("체크섬 일치 표본 → true", () => {
    // 900101-1234568: Σ(가중치)=124, (11-124%11)%10=8 = 13번째 자리.
    expect(rrnChecksumOk("900101-1234568")).toBe(true);
  });

  it("체크섬 불일치 → false(차단 아님)", () => {
    expect(rrnChecksumOk("900101-1234567")).toBe(false);
  });

  it("형식 오류는 HARD 가 처리 → true(SOFT 비관여)", () => {
    expect(rrnChecksumOk("123")).toBe(true);
  });
});

describe("patientCreateSchema", () => {
  const base: PatientCreateValues = {
    resident_no: "900101-1234567",
    name: "홍길동",
    phone: "",
    address: "",
    email: "",
    insurance_type: "health_insurance",
    insurance_no: "",
  };

  it("유효 입력 → 통과", () => {
    expect(patientCreateSchema.safeParse(base).success).toBe(true);
  });

  it("HARD 실패 주민번호 → 거부", () => {
    const res = patientCreateSchema.safeParse({ ...base, resident_no: "900101-9234567" });
    expect(res.success).toBe(false);
  });

  it("이름 누락 → 거부", () => {
    expect(patientCreateSchema.safeParse({ ...base, name: "" }).success).toBe(false);
  });

  it("보험유형 미선택 → 거부", () => {
    expect(patientCreateSchema.safeParse({ ...base, insurance_type: "" }).success).toBe(false);
  });

  it("잘못된 이메일 → 거부, 빈/유효 이메일 → 통과(옵셔널 형식 검증)", () => {
    expect(patientCreateSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...base, email: "" }).success).toBe(true);
    expect(patientCreateSchema.safeParse({ ...base, email: "a@b.com" }).success).toBe(true);
  });
});

describe("toPatientCreatePayload", () => {
  it("빈 옵셔널 제거(서버 None 계약) + 필수 유지", () => {
    const payload = toPatientCreatePayload({
      resident_no: "900101-1234567",
      name: "홍길동",
      phone: "",
      address: "",
      email: "",
      insurance_type: "health_insurance",
      insurance_no: "",
    });
    expect(payload).toEqual({
      resident_no: "900101-1234567",
      name: "홍길동",
      insurance_type: "health_insurance",
    });
    expect("phone" in payload).toBe(false);
  });

  it("채워진 옵셔널은 포함", () => {
    const payload = toPatientCreatePayload({
      resident_no: "900101-1234567",
      name: "홍길동",
      phone: "010-1234-5678",
      address: "서울시",
      email: "a@b.com",
      insurance_type: "self_pay",
      insurance_no: "X1",
    });
    expect(payload.phone).toBe("010-1234-5678");
    expect(payload.insurance_no).toBe("X1");
  });
});

// ── 임상 프로필(Story 3.2) ────────────────────────────────────────────────────

const VALID_CLINICAL: ClinicalProfileValues = {
  blood_type: "A+",
  allergies: "페니실린",
  chronic_diseases: "고혈압",
  medications: "와파린",
  notes: "보호자 동반",
};

describe("clinicalProfileSchema (Pydantic 거울)", () => {
  it("유효 입력 통과", () => {
    expect(clinicalProfileSchema.safeParse(VALID_CLINICAL).success).toBe(true);
  });

  it("blood_type 빈 값(미상)은 허용", () => {
    expect(
      clinicalProfileSchema.safeParse({ ...VALID_CLINICAL, blood_type: "" }).success,
    ).toBe(true);
  });

  it("blood_type 폐쇄어휘 위반 → 실패", () => {
    const res = clinicalProfileSchema.safeParse({ ...VALID_CLINICAL, blood_type: "Z+" });
    expect(res.success).toBe(false);
  });

  it("자유텍스트 max_length 초과 → 실패", () => {
    const res = clinicalProfileSchema.safeParse({
      ...VALID_CLINICAL,
      allergies: "가".repeat(1001),
    });
    expect(res.success).toBe(false);
  });
});

describe("toClinicalProfilePayload", () => {
  it("빈 값은 null 로 전송(명시 삭제 — PUT 전체 교체)", () => {
    const payload = toClinicalProfilePayload({
      blood_type: "",
      allergies: "",
      chronic_diseases: "",
      medications: "",
      notes: "",
    });
    expect(payload).toEqual({
      blood_type: null,
      allergies: null,
      chronic_diseases: null,
      medications: null,
      notes: null,
    });
  });

  it("채워진 값은 그대로 전송", () => {
    const payload = toClinicalProfilePayload(VALID_CLINICAL);
    expect(payload.blood_type).toBe("A+");
    expect(payload.allergies).toBe("페니실린");
  });
});

describe("bloodTypeLabel", () => {
  it("값 있으면 그대로, 없으면 미확인", () => {
    expect(bloodTypeLabel("AB-")).toBe("AB-");
    expect(bloodTypeLabel(null)).toBe("미확인");
    expect(bloodTypeLabel("")).toBe("미확인");
  });
});

// ── 전역 환자 검색(Story 3.5) ────────────────────────────────────────────────

const SEARCH_ITEM: PatientListItem = {
  id: "p1",
  chart_no: "00000001",
  name: "홍길동",
  birth_date: "1990-01-01",
  sex: "male",
  resident_no_masked: "900101-1******",
  phone: "010-1234-5678",
  is_active: true,
  created_at: "2026-06-21T00:00:00Z",
};

describe("searchPatients", () => {
  it("GET /v1/patients?q= 로 호출하고 data 배열을 반환한다(q 인코딩·page_size 기본 20)", async () => {
    mockApiFetch.mockResolvedValueOnce({
      data: [SEARCH_ITEM],
      meta: { page: 1, page_size: 20, total: 1 },
    });

    const result = await searchPatients("홍길동");

    expect(result).toEqual([SEARCH_ITEM]);
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/v1/patients?q=${encodeURIComponent("홍길동")}&page_size=20`,
      { signal: undefined },
    );
  });

  it("AbortSignal·커스텀 pageSize 를 전달한다(경쟁 결과 취소·상한)", async () => {
    mockApiFetch.mockResolvedValueOnce({
      data: [],
      meta: { page: 1, page_size: 5, total: 0 },
    });
    const ctrl = new AbortController();

    await searchPatients("010-1234", ctrl.signal, 5);

    expect(mockApiFetch).toHaveBeenCalledWith(
      `/v1/patients?q=${encodeURIComponent("010-1234")}&page_size=5`,
      { signal: ctrl.signal },
    );
  });
});
