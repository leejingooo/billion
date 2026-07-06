-- ============================================================
-- 매매 콘솔 · Supabase 스키마 (서버 저장 / 다기기 동기화)
-- Supabase 프로젝트 → SQL Editor 에 붙여넣고 실행.
--
-- 설계: 사용자별 KV 한 테이블. 앱의 모든 저장 키
--   ("accounts:index", "ui:prices", "acct:{id}:...", "migrated:local-v1")
--   가 (user_id, k) 행으로 저장된다. RLS 로 본인 행만 접근.
-- ============================================================

create table if not exists public.user_kv (
  user_id uuid not null references auth.users (id) on delete cascade,
  k       text not null,
  v       text,
  updated_at timestamptz not null default now(),
  primary key (user_id, k)
);

alter table public.user_kv enable row level security;

-- 본인 행만 읽고 쓴다.
drop policy if exists "user_kv_select_own" on public.user_kv;
create policy "user_kv_select_own" on public.user_kv
  for select using (auth.uid() = user_id);

drop policy if exists "user_kv_insert_own" on public.user_kv;
create policy "user_kv_insert_own" on public.user_kv
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_kv_update_own" on public.user_kv;
create policy "user_kv_update_own" on public.user_kv
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_kv_delete_own" on public.user_kv;
create policy "user_kv_delete_own" on public.user_kv
  for delete using (auth.uid() = user_id);

-- upsert 시 updated_at 갱신
create or replace function public.touch_user_kv() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_user_kv on public.user_kv;
create trigger trg_touch_user_kv before update on public.user_kv
  for each row execute function public.touch_user_kv();
