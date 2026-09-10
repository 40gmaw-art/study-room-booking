import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const siteUrl = "https://gongmyeong-studyroom.vercel.app";
const siteTitle = "가천대학교 제40대 경영대학 공명 스터디룸 예약";
const siteDescription = "가천대학교 경영대학 학생을 위한 공명 스터디룸 예약 서비스입니다.";
// Dedicated link-preview asset, kept separate from the home-page hero image
// (components/main-hero-image.tsx) so the two can change independently.
// Explicitly absolute (not left to metadataBase resolution) per the exact
// URL the OG/Twitter tags need to expose to Kakao and other crawlers.
const ogImagePath = "/images/og-image.png";
const ogImageUrl = `${siteUrl}${ogImagePath}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: siteTitle,
  description: "가천대학교 경영대학 학생을 위한 공명 스터디룸 예약 서비스입니다. 평일만 이용 가능하며 오늘부터 다음 주 금요일까지 예약할 수 있습니다.",
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: siteUrl,
    siteName: siteTitle,
    type: "website",
    locale: "ko_KR",
    images: [{ url: ogImageUrl, width: 1411, height: 783, alt: siteTitle }],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [ogImageUrl],
  },
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
