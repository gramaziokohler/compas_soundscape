import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { ColorThemeSync } from "@/components/layout/ColorThemeSync";
import "./globals.css";

const COLOR_THEME_BOOTSTRAP = `(function(){
  try {
    var stored = localStorage.getItem('compas-color-theme');
    var pref = stored === 'light' || stored === 'dark' ? stored : 'system';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (e) {}
})();`;

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sound is blue",
  description: "Populate your architectural model with contextualized sound events",
  icons: {
    icon: '/compas_icon_white.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <Script
          id="compas-color-theme"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: COLOR_THEME_BOOTSTRAP }}
        />
        <ColorThemeSync />
        {children}
      </body>
    </html>
  );
}
