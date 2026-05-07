import { Navigate, Route, Routes } from "react-router-dom";
import AdminPage from "./pages/AdminPage";
import VolunteerPage from "./pages/VolunteerPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/volunteer" replace />} />
      <Route path="/volunteer" element={<VolunteerPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/volunteer" replace />} />
    </Routes>
  );
}

export default App;
