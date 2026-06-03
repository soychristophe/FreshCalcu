-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: consolidate freshways-history → freshways-products
-- Run this against the freshways-products D1 database ONCE.
--
--   wrangler d1 execute freshways-products --file=schema-migration.sql
--
-- The old `freshways-history` binding and database can be deleted after this.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── history (today's session scan log) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode_id   TEXT    NOT NULL,
  product_name TEXT    NOT NULL,
  qty          REAL,
  pull_qty     REAL,
  scanned_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Run this ALTER only if migrating an existing DB (skip if creating fresh):
-- ALTER TABLE history ADD COLUMN qty      REAL;
-- ALTER TABLE history ADD COLUMN pull_qty REAL;

CREATE INDEX IF NOT EXISTS idx_history_scanned_at ON history (scanned_at);

-- ── history_all (permanent audit log) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS history_all (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode_id   TEXT    NOT NULL,
  product_name TEXT    NOT NULL,
  qty          REAL,
  pull_qty     REAL,
  scanned_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_history_all_scanned_at ON history_all (scanned_at);
