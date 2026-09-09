-- Entries created by a statement import share a batch id so the whole
-- import can be undone in one delete. Manually created entries leave it null.
alter table entries add column import_batch uuid;

create index on entries (user_id, import_batch);
