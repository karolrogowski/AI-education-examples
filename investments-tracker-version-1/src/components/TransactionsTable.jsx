import './TransactionsTable.css'

const ACTION_COLORS = {
  buy: '#4ade80',
  sell: '#f87171',
  dividend: '#facc15',
}

const TYPE_LABELS = {
  stock: '📈 Stock',
  bond: '🏦 Bond',
  etf: '📊 ETF',
  crypto: '₿ Crypto',
  cash: '💵 Cash',
  precious_metal: '🥇 Metal',
  other: '• Other',
}

export default function TransactionsTable({ rows }) {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : []

  return (
    <div className="table-wrapper">
      <p className="table-meta">{rows.length} transaction{rows.length !== 1 ? 's' : ''}</p>
      <div className="table-scroll">
        <table className="tx-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map(col => (
                  <td key={col} data-col={col}>
                    {formatCell(col, row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatCell(col, value) {
  if (col === 'action') {
    return (
      <span className="badge" style={{ color: ACTION_COLORS[value] ?? '#e2e8f0' }}>
        {value}
      </span>
    )
  }
  if (col === 'type') {
    return TYPE_LABELS[value] ?? value
  }
  if (col === 'quantity' || col === 'price') {
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 })
  }
  return value
}
