import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Conciliação Bancária",
  description: "Conciliação temporária entre razão Protheus e extratos bancários",
  robots: { index: false, follow: false, noarchive: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
