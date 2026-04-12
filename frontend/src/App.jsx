import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { NavBar }    from "./components/NavBar/NavBar";
import { Home }      from "./pages/Home/Home";
import { Processing } from "./pages/Processing/Processing";
import "./index.css";

function Layout() {
  const navigate = useNavigate();
  return (
    <>
      <NavBar onLogoClick={() => navigate("/")} />
      <Routes>
        <Route path="/"                    element={<Home />} />
        <Route path="/processing/:jobId"   element={<Processing />} />
        <Route path="*"                    element={<Home />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}
