import type { Metadata } from "next";
import "./globals.css";
import { SideNav } from "@/components/side-nav";

export const metadata: Metadata = {
  title: "Vertex Outreach · Painel de Prospecção",
  description: "Automação comercial no Instagram — funis de clientes e afiliados",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-[#0B0E12] text-zinc-200 antialiased">
        <div className="flex min-h-screen">
          <SideNav />
          <main className="flex-1 px-6 py-6 lg:px-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
