import LedgerTable from '../components/LedgerTable';

// View-only for everyone, admins included. Corrections live at /admin/ledger.
export default function Ledger() {
  return <LedgerTable />;
}
