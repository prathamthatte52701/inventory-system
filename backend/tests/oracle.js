// Independent re-derivation of every ledger number from opening stock + the ordered movements.
const sorted = (ms) => [...ms].sort((a, b) => +new Date(a.movementDate) - +new Date(b.movementDate) || +new Date(a.createdAt) - +new Date(b.createdAt) || (a._id < b._id ? -1 : 1));

function oracle(opening, ms) {
  let qty = opening.qty, rate = opening.rate;
  const rows = [];
  for (const m of ms) {
    let r, amt, ex = false;
    if (m.type === 'IN') { r = m.enteredRate; rate = qty <= 0 ? r : (qty * rate + m.quantity * r) / (qty + m.quantity); qty += m.quantity; amt = m.quantity * r; }
    else if (m.type === 'OUT') { r = rate; ex = m.quantity > qty; qty -= m.quantity; amt = m.quantity * r; }
    else { r = rate; qty += m.quantity; amt = m.quantity * r; }
    rows.push({ rate: r, amount: amt, bal: qty, ex });
  }
  return { rows, qty, rate };
}

module.exports = { sorted, oracle };
