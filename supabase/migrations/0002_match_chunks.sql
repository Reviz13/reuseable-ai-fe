create or replace function match_chunks(
  p_app text,
  p_embedding vector(384),
  p_k int,
  p_min_score real
)
returns table (
  chunk_id uuid,
  document_id uuid,
  title text,
  heading text,
  content text,
  version int,
  score real
)
language sql
stable
as $$
  select
    c.id,
    d.id,
    d.title,
    c.heading,
    c.content,
    v.version,
    (1 - (c.embedding <=> p_embedding))::real as score
  from chunks c
  join documents d on d.active_version_id = c.version_id
  join document_versions v on v.id = c.version_id
  where d.app = p_app
    and c.app = p_app
    and d.status = 'ready'
    and (1 - (c.embedding <=> p_embedding)) >= p_min_score
  order by c.embedding <=> p_embedding
  limit p_k;
$$;
