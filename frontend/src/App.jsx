import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import MainLayout from './MainLayout';
import AdminLayout from './AdminLayout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Materials from './pages/Materials';
import Movement from './pages/Movement';
import Ledger from './pages/Ledger';
import Reports from './pages/Reports';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminMaterials from './pages/admin/AdminMaterials';
import AdminLedger from './pages/admin/AdminLedger';
import AdminUsers from './pages/admin/AdminUsers';
import AdminAudit from './pages/admin/AdminAudit';
import AdminAnalytics from './pages/admin/AdminAnalytics';

const guard = (el, adminOnly) => <ProtectedRoute adminOnly={adminOnly}>{el}</ProtectedRoute>;

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/" element={guard(<Dashboard />)} />
        <Route path="/materials" element={guard(<Materials />)} />
        <Route path="/movement" element={guard(<Movement />)} />
        <Route path="/ledger" element={guard(<Ledger />)} />
        <Route path="/reports" element={guard(<Reports />)} />
      </Route>
      <Route path="/admin" element={guard(<AdminLayout />, true)}>
        <Route index element={<AdminDashboard />} />
        <Route path="materials" element={<AdminMaterials />} />
        <Route path="ledger" element={<AdminLedger />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="audit" element={<AdminAudit />} />
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
