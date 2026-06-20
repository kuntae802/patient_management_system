import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

// Pretendard 자체 호스팅(번들) — @font-face/외부 네트워크 없이 OS 무관 동일 렌더.
// weight "45 920" = 가변 폰트 범위(미지정 시 WebKit 가중치 렌더 오류).
// display "swap" = 로드 중 폴백 표시(FOUT) → 텍스트 항상 가시. 동일출처 번들이라 스왑 창은 짧음.
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  weight: "45 920",
  display: "swap",
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: "환자 관리 시스템",
  description: "중소병원 외래 환자 관리 시스템 (PMS)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
