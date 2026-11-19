import './globals.css';

export const metadata = {
  title: 'ChaosSlip',
  description: 'Live GTA challenge parlays',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
