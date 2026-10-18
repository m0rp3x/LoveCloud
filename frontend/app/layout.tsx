import type { Metadata } from 'next';
import './styles/fonts.css';
import './styles/workspace.css';
import './styles/shell.css';
import './styles/drawn.css';
import './styles/app.css';
import './styles/rose.css';
import './styles/cloud.css';
import './styles/onboarding.css';
import ClientProviders from '@/components/client-providers';
export const metadata:Metadata={title:'LoveCloud — наше облако',description:'Наше общее пространство: файлы, воспоминания, дела и желания',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ru"><body data-theme="berry" data-desk-mode="desk"><ClientProviders>{children}</ClientProviders></body></html>;}
