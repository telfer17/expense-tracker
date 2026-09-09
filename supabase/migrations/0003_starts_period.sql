-- An entry can mark the start of a financial period (e.g. the salary that
-- opens it). Periods run from one marked entry's date to the day before the
-- next marked entry's date. Null/false = an ordinary entry.
alter table entries add column starts_period boolean;

create index on entries (user_id, entry_date) where starts_period;
