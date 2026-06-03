-- Run this ONCE against your production D1 database to add qty columns to history:
--   wrangler d1 execute freshways-products --remote --command="ALTER TABLE history ADD COLUMN qty REAL"
--   wrangler d1 execute freshways-products --remote --command="ALTER TABLE history ADD COLUMN pull_qty REAL"

ALTER TABLE history ADD COLUMN qty      REAL;
ALTER TABLE history ADD COLUMN pull_qty REAL;
