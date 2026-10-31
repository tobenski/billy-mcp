-- Applied before BILLY_TEST_GUARDED_WRITES is enabled. Legacy pending rows
-- deliberately retain NULL phase and cannot be automatically resumed.
ALTER TABLE operations ADD COLUMN attempt_token TEXT;
ALTER TABLE operations ADD COLUMN write_phase TEXT;
ALTER TABLE operations ADD COLUMN lease_until INTEGER;
