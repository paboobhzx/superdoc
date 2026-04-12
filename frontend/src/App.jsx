import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom"
import AppShell from "./components/layout/AppShell"
import { Home } from "./pages/Home/Home"
import { Processing } from "./pages/Processing/Processing"
import { Login } from "./pages/auth/Login"
import { Register } from "./pages/auth/Register"
import { ConfirmEmail } from "./pages/auth/ConfirmEmail"
import { Settings } from "./pages/Settings"
import "./index.css"

const NO_SHELL_PATHS = ['/auth/login', '/auth/register', '/auth/confirm']

function AppRoutes() {
  const { pathname } = useLocation()
  const noShell = NO_SHELL_PATHS.some(p => pathname.startsWith(p))

  const routes = (
    <Routes>
      <Route path="/" element={<Home />} />
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
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
