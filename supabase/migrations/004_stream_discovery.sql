-- Optional host-supplied stream information. Viewer counts are snapshots, not a live API feed.
begin;
alter table public.sessions
  add column if not exists streamer_name text,
  add column if not exists game_name text,
  add column if not exists stream_url text,
  add column if not exists thumbnail_url text,
  add column if not exists viewer_count integer check (viewer_count >= 0);
commit;
