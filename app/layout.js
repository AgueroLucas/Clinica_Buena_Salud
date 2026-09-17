import './globals.css'
import { Providers } from './providers'
import { Toaster } from 'sonner'

export const metadata = {
  title: 'Clínica Buena Salud — Gestión de Turnos',
  description: 'Sistema premium de gestión de turnos médicos para clínica privada de lujo',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{__html:'window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);'}} />
      </head>
      <body>
        <Providers>
          {children}
          <Toaster position="top-right" richColors closeButton theme="light" toastOptions={{ style: { fontFamily: 'Inter, sans-serif' } }} />
        </Providers>
      </body>
    </html>
  )
}
