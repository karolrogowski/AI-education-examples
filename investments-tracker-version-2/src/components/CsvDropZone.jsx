import { useState, useEffect, useRef, useCallback } from 'react';
import Papa from 'papaparse';
import './CsvDropZone.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXAMPLE_CSV_PATH = '/example-data/portfolio.csv';

const REQUIRED_COLUMNS = [
  'date', 'ticker', 'name', 'type', 'action',
  'quantity', 'price', 'currency', 'broker',
];

// Normalize non-canonical type values that appear in real CSVs
const TYPE_ALIASES = {
  stocks: 'etf',
  bonds:  'bond',
  metal:  'precious_metal',
  metals: 'precious_metal',
};

// ---------------------------------------------------------------------------
// Pure parse / validation helpers (no React)
// ---------------------------------------------------------------------------

/**
 * Run PapaParse on a CSV string. Returns the raw PapaParse result object.
 * Auto-detects delimiter (comma or semicolon).
 */
function parseText(text) {
  return Papa.parse(text, {
    header:          true,
    delimiter:       '',           // '' = auto-detect
    skipEmptyLines:  true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
}

/**
 * Run PapaParse on a File object. Returns a promise that resolves to the
 * raw PapaParse result.
 */
function parseFile(file) {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header:          true,
      delimiter:       '',
      skipEmptyLines:  true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete:        resolve,
    });
  });
}

/**
 * Check that all required columns are present in the parsed headers.
 * Returns an array of missing column names (empty if all present).
 */
function missingColumns(fields) {
  return REQUIRED_COLUMNS.filter((col) => !fields.includes(col));
}

/**
 * Normalize a single row: apply type aliases, trim whitespace on key fields.
 */
function normalizeRow(row) {
  const rawType   = row.type?.trim().toLowerCase()   ?? '';
  const rawAction = row.action?.trim().toLowerCase() ?? '';
  return { ...row, type: TYPE_ALIASES[rawType] ?? rawType, action: rawAction };
}

/**
 * Validate and filter raw PapaParse rows.
 * - Skips rows with an unparseable date, non-numeric quantity, or non-numeric price.
 * - Collects human-readable warnings for every skipped row.
 * - Normalizes type aliases on rows that pass.
 *
 * @returns {{ valid: object[], warnings: string[] }}
 */
function validateRows(rawRows) {
  const valid    = [];
  const warnings = [];

  rawRows.forEach((row, idx) => {
    const lineNum = idx + 2; // 1-indexed, +1 for header row
    const ticker  = row.ticker ? ` (${row.ticker})` : '';

    if (!row.date || isNaN(new Date(row.date).getTime())) {
      warnings.push(`Row ${lineNum}${ticker}: invalid date "${row.date}" — skipped`);
      return;
    }

    const qty = Number(row.quantity);
    if (row.quantity === '' || isNaN(qty)) {
      warnings.push(`Row ${lineNum}${ticker}: non-numeric quantity "${row.quantity}" — skipped`);
      return;
    }

    const price = Number(row.price);
    if (row.price === '' || isNaN(price)) {
      warnings.push(`Row ${lineNum}${ticker}: non-numeric price "${row.price}" — skipped`);
      return;
    }

    valid.push(normalizeRow(row));
  });

  return { valid, warnings };
}

/**
 * Full pipeline: check columns → validate rows → return result or error.
 *
 * @returns {{ error: string }|{ rows: object[], warnings: string[] }}
 */
function processParsed(result) {
  const fields  = result.meta?.fields ?? [];
  const missing = missingColumns(fields);
  if (missing.length > 0) {
    return { error: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` };
  }
  const { valid, warnings } = validateRows(result.data);
  return { rows: valid, warnings };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CsvDropZone — handles all CSV ingestion for the app.
 *
 * Responsibilities:
 *   1. Auto-loads /example-data/portfolio.csv on mount.
 *   2. Accepts drag-and-drop or file-picker uploads to replace the loaded data.
 *   3. Validates required columns and skips invalid rows with warnings.
 *   4. Calls onLoad(rows) whenever a valid file is loaded.
 *
 * Props:
 *   onLoad  {(rows: object[]) => void}  — called with validated, normalized rows
 */
export default function CsvDropZone({ onLoad }) {
  // status shape:
  //   { phase: 'loading' }
  //   { phase: 'idle' }
  //   { phase: 'loaded', filename, rowCount, warnings }
  //   { phase: 'error', message }
  const [status, setStatus]   = useState({ phase: 'loading' });
  const [dragging, setDragging] = useState(false);
  const fileInputRef            = useRef(null);

  // Stable callback — called by both auto-load and user-upload paths
  const applyResult = useCallback((result, filename) => {
    const outcome = processParsed(result);
    if ('error' in outcome) {
      setStatus({ phase: 'error', message: outcome.error });
      return;
    }
    setStatus({ phase: 'loaded', filename, rowCount: outcome.rows.length, warnings: outcome.warnings });
    onLoad(outcome.rows);
  }, [onLoad]);

  // Auto-load example CSV on mount
  useEffect(() => {
    fetch(EXAMPLE_CSV_PATH)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => applyResult(parseText(text), 'portfolio.csv (example)'))
      .catch((err) => {
        console.error('[CsvDropZone] Failed to load example CSV:', err);
        setStatus({ phase: 'idle' });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Shared handler for File objects (drag-drop or picker)
  const handleFiles = useCallback(async (files) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setStatus({ phase: 'error', message: 'Please select a .csv file.' });
      return;
    }
    setStatus({ phase: 'loading' });
    applyResult(await parseFile(file), file.name);
  }, [applyResult]);

  // Drag-and-drop handlers
  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    // Only clear when leaving the drop zone itself, not its children
    if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  // ---- Render ----

  const isLoading = status.phase === 'loading';

  return (
    <div
      className={`cdz-root${dragging ? ' cdz-root--dragging' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Left: current file info / status */}
      <div className="cdz-info">
        {status.phase === 'loading' && (
          <span className="cdz-status cdz-status--loading">Loading…</span>
        )}

        {status.phase === 'idle' && (
          <span className="cdz-status cdz-status--idle">No file loaded — drop a CSV or browse</span>
        )}

        {status.phase === 'loaded' && (
          <>
            <span className="cdz-filename">{status.filename}</span>
            <span className="cdz-rowcount">{status.rowCount.toLocaleString()} rows</span>
            {status.warnings.length > 0 && (
              <span
                className="cdz-warnings"
                title={status.warnings.join('\n')}
                aria-label={`${status.warnings.length} rows skipped. Hover for details.`}
              >
                ⚠ {status.warnings.length} row{status.warnings.length !== 1 ? 's' : ''} skipped
              </span>
            )}
          </>
        )}

        {status.phase === 'error' && (
          <span className="cdz-error">✕ {status.message}</span>
        )}
      </div>

      {/* Right: drop hint + browse button */}
      <div className="cdz-actions">
        <span className="cdz-drop-hint">
          {dragging ? 'Release to load' : 'Drop CSV or'}
        </span>
        <button
          className="cdz-browse-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          type="button"
        >
          Browse
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="cdz-file-input"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = ''; // allow re-selecting the same file
          }}
        />
      </div>
    </div>
  );
}
