import type { Metadata } from 'next';
import { Geist_Mono, Inter } from 'next/font/google';
import { TooltipProvider } from '@/components/ui/tooltip';
import { pitch } from '@/site';
import '@/app/site.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: { default: 'konat', template: '%s — konat' },
  description: pitch,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`antialiased ${inter.variable} ${geistMono.variable}`}>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
