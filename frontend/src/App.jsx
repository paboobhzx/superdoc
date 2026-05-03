import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom"
import AppShell from "./components/layout/AppShell"
import { Home } from "./pages/Home/Home"
import { MobileHome, hasDesktopPreference } from "./pages/Home/MobileHome"
import { Processing } from "./pages/Processing/Processing"
import { Login } from "./pages/auth/Login"
import { Register } from "./pages/auth/Register"
import { ConfirmEmail } from "./pages/auth/ConfirmEmail"
import { Settings } from "./pages/Settings"
import { Dashboard } from "./pages/Dashboard"
import { ImageEditor } from "./pages/ImageEditor"
import { PdfEditor } from "./pages/PdfEditor"
import { DocxEditor } from "./pages/DocxEditor"
import { MarkdownEditor } from "./pages/MarkdownEditor"
import { XlsxEditor } from "./pages/XlsxEditor"
import "./index.css"
import { AuthProvider } from "./context/AuthContext"

const NO_SHELL_PATHS = ['/auth/login', '/auth/register', '/auth/confirm']

function shouldRouteToMobile() {
  if (hasDesktopPreference()) return false
  if (typeof window === "undefined") return false
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(max-width: 767px), (pointer: coarse)").matches
  }
  return window.innerWidth > 0 && window.innerWidth < 768
}

function HomeEntry() {
  if (shouldRouteToMobile()) return <Navigate to="/m" replace />
  return <Home />
}

function AppRoutes() {
  const { pathname } = useLocation()
  const noShell = NO_SHELL_PATHS.some(p => pathname.startsWith(p))

  const routes = (
    <Routes>
      <Route path="/" element={<HomeEntry />} />
      <Route path="/m" element={<MobileHome />} />
      <Route path="/editor/image" element={<ImageEditor />} />
      <Route path="/editor/pdf" element={<PdfEditor />} />
      <Route path="/editor/docx" element={<DocxEditor />} />
      <Route path="/editor/markdown" element={<MarkdownEditor />} />
      <Route path="/editor/xlsx" element={<XlsxEditor />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/processing/:jobId" element={<Processing />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/auth/login" element={<Login />} />
      <Route path="/auth/register" element={<Register />} />
      <Route path="/auth/confirm" element={<ConfirmEmail />} />
      <Route path="*" element={<Home />} />
    </Routes>
  )

  if (noShell) return routes
  return <AppShell>{routes}</AppShell>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
