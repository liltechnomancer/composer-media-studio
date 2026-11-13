-- Show/hide is a placement control, separate from publish/withdraw.
ALTER TABLE publications ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
