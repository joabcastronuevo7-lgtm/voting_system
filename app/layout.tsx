import type { Metadata, Viewport } from "next";
import { Geist, Playfair_Display } from "next/font/google";
import "./globals.css";

const body = Geist({ variable: "--font-body", subsets: ["latin"] });
const display = Playfair_Display({ variable: "--font-display", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Dinner Awards 2026",
  description: "Register and vote for the Dinner Awards, December 2, 2026.",
};

export const viewport: Viewport = { themeColor: "#0b0a08", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full">
        <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-8">
          <p className="text-center text-xs uppercase tracking-[0.3em] text-gold">
            Dinner Awards 2026
          </p>
          {children}
        </main>
      </body>
    </html>
  );
}
