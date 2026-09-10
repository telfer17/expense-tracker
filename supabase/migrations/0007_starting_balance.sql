-- Optional running-balance anchor: the user's actual bank balance as of a
-- chosen date. Both null until set on the settings page; /entries only
-- shows a running balance when both are present.

alter table user_settings add column starting_balance numeric(12,2);
alter table user_settings add column starting_balance_date date;
