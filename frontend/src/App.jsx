import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import Navbar from './Navbar';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Materials from './pages/Materials';
import Movement from './pages/Movement';
import Ledger from './pages/Ledger';
import Users from './pages/Users';
import Reports from './pages/Reports';

const guard = (el, adminOnly) => <ProtectedRoute adminOnly={adminOnly}>{el}</ProtectedRoute>;

export default function App() {
  return (
    <>
      <Navbar />
      <main className="page">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/" element={guard(<Dashboard />)} />
          <Route path="/materials" element={guard(<Materials />)} />
          <Route path="/movement" element={guard(<Movement />)} />
          <Route path="/ledger" element={guard(<Ledger />)} />
          <Route path="/reports" element={guard(<Reports />)} />
          <Route path="/users" element={guard(<Users />, true)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
