revoke update, delete on audit_log from anon, authenticated, service_role;

create function audit_log_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on audit_log
  for each row execute function audit_log_append_only();

select cron.schedule(
  'purge-conversations',
  '0 3 * * *',
  $$delete from conversations where created_at < now() - interval '90 days'$$
);
