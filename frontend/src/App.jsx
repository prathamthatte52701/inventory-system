import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import MainLayout from './MainLayout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Materials from './pages/Materials';
import Movement from './pages/Movement';
import Ledger from './pages/Ledger';
import Reports from './pages/Reports';

const guard = (el) => <ProtectedRoute>{el}</ProtectedRoute>;

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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
