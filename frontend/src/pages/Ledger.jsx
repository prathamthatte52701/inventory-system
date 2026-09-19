import LedgerTable from '../components/LedgerTable';

// View-only for everyone, admins included. Corrections are made in the separate admin app.
export default function Ledger() {
  return <LedgerTable />;
}
