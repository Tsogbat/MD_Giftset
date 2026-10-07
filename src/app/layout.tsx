import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gift Set Studio",
  description: "ARTBOX Mongolia — agentic gift set and mystery box builder",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a href="/" className="brand">Gift Set Studio</a>
          <nav>
            <a href="/">Projects</a>
            <a href="/rules">Rules</a>
            <a href="/catalog">Catalog</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
