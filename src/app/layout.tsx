import type { Metadata } from "next";
import "./globals.css";
import { currentUser, viaLan } from "@/lib/user";

export const metadata: Metadata = {
  title: "Gift Set Studio",
  description: "ARTBOX Mongolia — agentic gift set and mystery box builder",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [me, lan] = await Promise.all([currentUser(), viaLan()]);
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
          <span className="me small muted">
            {me}
            {lan ? (
              <>
                {" · "}
                <a href="/__login">Change name</a> · <a href="/__logout">Sign out</a>
              </>
            ) : null}
          </span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
