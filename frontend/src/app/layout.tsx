import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { CustomerAccountProvider } from "@/components/site/customer-account";

export const metadata: Metadata = {
  title: "TableFlow — Dining, timed to perfection",
  description: "A considered way to reserve, arrive, and be welcomed.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body><CustomerAccountProvider>{children}</CustomerAccountProvider></body>
    </html>
  );
}
