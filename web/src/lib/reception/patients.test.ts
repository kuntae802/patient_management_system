import { describe, expect, it } from "vitest";

import {
  normalizeRrn,
  patientCreateSchema,
  rrnChecksumOk,
  rrnHardError,
  toPatientCreatePayload,
  type PatientCreateValues,
} from "./patients";

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
