create extension if not exists vector;
create extension if not exists pg_cron;

create table assistants (
  app text primary key,
  name text not null,
  persona_prompt text not null,
  language text not null default 'id',
  llm_adapter text not null default 'claude',
  llm_model text not null default 'claude-sonnet-5-5',
  fallback_adapter text,
  avatar_frames jsonb not null default '{}'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  allowed_origins text[] not null default '{}',
  min_score real not null default 0.78,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create table admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  apps text[] not null default '{}'
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  app text not null,
  kind text not null check (kind in ('file', 'faq')),
  title text not null,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  active_version_id uuid,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  version int not null,
  source_path text,
  checksum text,
  embedding_model text,
  error text,
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

alter table documents
  add constraint documents_active_version_fk
  foreign key (active_version_id) references document_versions (id)
  deferrable initially deferred;

create table chunks (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references document_versions (id) on delete cascade,
  app text not null,
  ord int not null,
  heading text,
  content text not null,
  embedding vector(384) not null,
  token_count int not null
);
create index chunks_embedding_hnsw on chunks using hnsw (embedding vector_cosine_ops);
create index chunks_app_version on chunks (app, version_id);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  app text not null,
  user_id text not null,
  outlet_id text,
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb,
  tool_calls jsonb,
  guardrail_replaced boolean not null default false,
  latency_ms int,
  created_at timestamptz not null default now()
);

create table feedback (
  message_id uuid primary key references messages (id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  comment text,
  created_at timestamptz not null default now()
);

create table knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  app text not null,
  question text not null,
  top_score real,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  app text not null,
  actor_type text not null check (actor_type in ('end_user', 'admin')),
  actor_id text,
  outlet_id text,
  action text not null,
  params jsonb,
  outcome text not null check (outcome in ('ok', 'forbidden', 'error')),
  error_code text,
  duration_ms int
);

-- RLS on every table, deliberately NO policies: only service_role (which bypasses RLS) can access.
alter table assistants enable row level security;
alter table admins enable row level security;
alter table documents enable row level security;
alter table document_versions enable row level security;
alter table chunks enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table feedback enable row level security;
alter table knowledge_gaps enable row level security;
alter table audit_log enable row level security;

insert into storage.buckets (id, name, public) values
  ('knowledge', 'knowledge', false),
  ('avatars', 'avatars', true)
on conflict do nothing;
