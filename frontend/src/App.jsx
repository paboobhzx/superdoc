import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom"
import AppShell from "./components/layout/AppShell"
import { Home } from "./pages/Home/Home"
import { Processing } from "./pages/Processing/Processing"
import { Login } from "./pages/auth/Login"
import { Register } from "./pages/auth/Register"
import { ConfirmEmail } from "./pages/auth/ConfirmEmail"
import { Settings } from "./pages/Settings"
import { Dashboard } from "./pages/Dashboard"
import { Tools } from "./pages/Tools"
import { ImageEditor } from "./pages/ImageEditor"
import { PdfEditor } from "./pages/PdfEditor"
import { DocxEditor } from "./pages/DocxEditor"
import { XlsxEditor } from "./pages/XlsxEditor"
import "./index.css"
import { AuthProvider } from "./context/AuthContext"

const NO_SHELL_PATHS = ['/auth/login', '/auth/register', '/auth/confirm']

function AppRoutes() {
  const { pathname } = useLocation()
  const noShell = NO_SHELL_PATHS.some(p => pathname.startsWith(p))

  const routes = (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/tools" element={<Tools />} />
      <Route path="/editor/image" element={<ImageEditor />} />
      <Route path="/editor/pdf" element={<PdfEditor />} />
      <Route path="/editor/docx" element={<DocxEditor />} />
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
