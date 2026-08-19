import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Concilia — Razão Protheus × Extratos Bancários",
  description: "Razão Protheus × Extratos Bancários",
  robots: { index: false, follow: false, noarchive: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
