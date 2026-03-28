import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { CameraView } from "./pages/CameraView";
import { Dashboard } from "./pages/Dashboard";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/camera" element={<CameraView />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
