-- S2: audit_log is append-only (spec section 6). 0003 blocks UPDATE/DELETE; TRUNCATE skips row
-- triggers, so it is revoked and blocked by a statement-level trigger as well.
revoke truncate on audit_log from anon, authenticated, service_role;

create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function audit_log_append_only();
