insert into assistants (app, name, persona_prompt, language, llm_adapter, llm_model, min_score, allowed_origins, theme, avatar_frames)
values (
  'pos',
  'NEXUS',
  'You are NEXUS, the AI assistant in the Hitachi POS app for the Kopi Tepi outlet. Answer briefly, warmly, and clearly in English.',
  'en',
  'claude',
  'claude-sonnet-5-5',
  0.78,
  '{"http://localhost:3000"}',
  '{"accent":"#6d4aff"}'::jsonb,
  '{}'::jsonb
)
on conflict (app) do nothing;
