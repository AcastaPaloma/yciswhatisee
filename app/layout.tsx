import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Panel: the hiring agent that interviews every finalist at once",
  description: "Source on Ploid, interview in parallel with ElevenLabs voice agents, and adapt questions live.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased bg-neutral-950">{children}</body>
    </html>
  );
}
