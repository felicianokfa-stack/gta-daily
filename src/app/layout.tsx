import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GTA DAILY · Central de Conteúdo",
  description: "Plataforma multiagente de pesquisa, verificação e produção de conteúdo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
