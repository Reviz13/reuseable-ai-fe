insert into assistants (app, name, persona_prompt, language, llm_adapter, llm_model, min_score, allowed_origins, theme, avatar_frames)
values (
  'pos',
  'NEXUS',
  'Kamu adalah NEXUS, asisten AI di aplikasi Hitachi POS untuk outlet Kopi Tepi. Jawab singkat, ramah, dan jelas dalam Bahasa Indonesia.',
  'id',
  'claude',
  'claude-sonnet-5-5',
  0.78,
  '{"http://localhost:3000"}',
  '{"accent":"#6d4aff"}'::jsonb,
  '{}'::jsonb
)
on conflict (app) do nothing;
