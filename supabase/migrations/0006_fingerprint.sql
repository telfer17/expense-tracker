-- Duplicate-detection fingerprints. A fingerprint hashes
-- entry_date + amount + the normalised RAW statement description
-- (lowercased, whitespace collapsed) — never the cleaned one, so
-- changing cleaning rules can't break matching. Manual entries hash
-- their note instead; entries with no note keep null, which never
-- matches anything.

alter table entries add column fingerprint text;

create index entries_user_fingerprint_idx on entries (user_id, fingerprint);
