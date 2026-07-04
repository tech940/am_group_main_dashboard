import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { SidebarProvider } from "@/context/sidebar-context";
import { DashboardQueryProvider } from "@/components/providers/query-provider";
import { ActivityTracker } from "@/components/providers/activity-tracker";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AM Group | Operations Cloud",
  description: "Manage your operations across all branches with the AM Group Dashboard.",
};

import NextTopLoader from 'nextjs-toploader';
import { ThemeInitializer } from './theme-initializer';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      data-dashboard-accent="executive-navy"
      suppressHydrationWarning
    >
      <head>
        <ThemeInitializer />
      </head>
      <body className="min-h-full flex flex-col">
        <NextTopLoader 
          color="var(--dashboard-primary)"
          initialPosition={0.08}
          crawlSpeed={200}
          height={3}
          crawl={true}
          showSpinner={false}
          easing="ease"
          speed={200}
          shadow="0 0 12px color-mix(in srgb, var(--dashboard-primary) 62%, transparent),0 0 6px color-mix(in srgb, var(--dashboard-primary) 42%, transparent)"
        />
        <DashboardQueryProvider>
          <SidebarProvider>
            <Suspense fallback={null}>
              <ActivityTracker />
            </Suspense>
            {children}
          </SidebarProvider>
        </DashboardQueryProvider>
      </body>
    </html>
  );
}
