-- Access needs a confirmed address: an unconfirmed sign-up with an allowed email reads nothing.
create or replace function dash.allowed() returns boolean
language sql stable security definer set search_path = dash, public as $$
  select coalesce(exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and lower(u.email) in (select lower(jsonb_array_elements_text(value)) from dash.config where key = 'allowed_emails')
  ), false);
$$;
