import { Routes, Route, Navigate } from 'react-router-dom';
import RequireAdmin from './RequireAdmin';
import Layout from './Layout';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import AdminMaterials from './pages/AdminMaterials';
import AdminLedger from './pages/AdminLedger';
import AdminUsers from './pages/AdminUsers';
import AdminAudit from './pages/AdminAudit';
import AdminAnalytics from './pages/AdminAnalytics';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAdmin><Layout /></RequireAdmin>}>
        <Route index element={<AdminDashboard />} />
        <Route path="materials" element={<AdminMaterials />} />
        <Route path="ledger" element={<AdminLedger />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="audit" element={<AdminAudit />} />
        <Route path="analytics" element={<AdminAnalytics />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
