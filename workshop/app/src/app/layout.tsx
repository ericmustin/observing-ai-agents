import type { Metadata } from 'next';
import './globals.css';
import Nav from './components/nav';

export const metadata: Metadata = {
  title: "Observable Travel Planner",
  description: "Observable Travel Planner AI Agent Example",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="flex flex-col">
          <Nav/>
          <main className="main-content">
            {children}
          </main>
          <footer className="footer">
          Travel planner by Carly Richmond 💜 · LLM observability 101 workshop edition
          </footer>
        </div>
      </body>
    </html>
  );
}
