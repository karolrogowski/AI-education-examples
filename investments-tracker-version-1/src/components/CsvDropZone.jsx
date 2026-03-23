import { useRef, useState } from 'react'
import Papa from 'papaparse'
import './CsvDropZone.css'

const REQUIRED_COLUMNS = ['date', 'ticker', 'name', 'type', 'action', 'quantity', 'price', 'currency', 'broker']

export default function CsvDropZone({ onData, compact = false }) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef()

  function parseFile(file) {
    if (!file || !file.name.endsWith('.csv')) {
      setError('Please provide a .csv file.')
      return
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete({ data, meta }) {
        const missing = REQUIRED_COLUMNS.filter(c => !meta.fields.includes(c))
        if (missing.length) {
          setError(`CSV is missing columns: ${missing.join(', ')}`)
          return
        }
        setError(null)
        // Normalise type aliases so the app's internal types are always canonical
        const TYPE_ALIASES = { stocks: 'etf', bonds: 'bond', metal: 'precious_metal', metals: 'precious_metal' }
        // dividend rows are ignored — dividends are fetched automatically
        const rows = data
          .filter(r => r.action !== 'dividend')
          .map(r => ({ ...r, type: TYPE_ALIASES[r.type] ?? r.type }))
        onData(rows, file.name)
      },
      error(err) {
        setError(`Parse error: ${err.message}`)
      },
    })
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    parseFile(e.dataTransfer.files[0])
  }

  function onFileChange(e) {
    parseFile(e.target.files[0])
  }

  return (
    <div className={`dropzone-wrapper ${compact ? 'dropzone-wrapper--compact' : ''}`}>
      <div
        className={`dropzone ${compact ? 'dropzone--compact' : ''} ${dragging ? 'dropzone--over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current.click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && inputRef.current.click()}
      >
        {compact ? (
          <p className="dropzone-compact-label">📂 Drop a CSV to replace data, or <span className="dropzone-link">browse</span></p>
        ) : (
          <>
            <div className="dropzone-icon">📂</div>
            <p className="dropzone-title">Drop your CSV file here</p>
            <p className="dropzone-sub">or click to browse</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={onFileChange}
        />
      </div>

      {error && <p className="dropzone-error">{error}</p>}

      {!compact && (
        <div className="dropzone-hint">
          <p>Expected columns:</p>
          <code>{REQUIRED_COLUMNS.join(', ')}</code>
        </div>
      )}
    </div>
  )
}
