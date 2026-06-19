-- THE-772 — chat attachments (images / files on messages).
-- Run in the Supabase SQL editor. Idempotent.
--
-- Files live in a PRIVATE Storage bucket `chat-attachments`; only the path is stored here and
-- the app hands out short-lived signed URLs (generated server-side after the conversation
-- access check), so attachments stay private. body stays NOT NULL — attachment-only messages
-- store an empty string.

alter table public.messages add column if not exists attachment_path text;
alter table public.messages add column if not exists attachment_name text;
alter table public.messages add column if not exists attachment_type text;
alter table public.messages add column if not exists attachment_size integer;
