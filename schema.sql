-- HerJewels Money Tracker - database schema
-- Run this whole file once in Supabase: SQL Editor -> New query -> paste -> Run

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  variant text default '',
  price numeric not null default 0,
  cost numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists weeks (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  week_date date not null default current_date,
  delivered int not null default 0,
  cancelled int not null default 0,
  created_at timestamptz default now()
);

-- one row per product used inside a week, quantities split COD vs already-paid
create table if not exists week_items (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  product_id uuid not null references products(id),
  qty_cod int not null default 0,
  qty_paid int not null default 0,
  unit_price numeric not null,   -- snapshot at time of entry, doesn't change if product price changes later
  unit_cost numeric not null     -- snapshot at time of entry, doesn't change if product cost changes later
);

create table if not exists ads (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  amount numeric not null default 0,
  ad_date date not null default current_date,
  created_at timestamptz default now()
);

create table if not exists settings (
  id int primary key default 1,
  employee numeric not null default 0,
  stock numeric not null default 0,
  other numeric not null default 0,
  bank numeric not null default 0,
  check (id = 1)
);
insert into settings (id) values (1) on conflict (id) do nothing;

create table if not exists legacy_batches (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  delivered int not null default 0,
  cancelled int not null default 0,
  revenue numeric not null default 0,
  capital numeric not null default 0,
  ads numeric not null default 0
);

-- ---- Row Level Security ----
-- This app is protected by a PIN screen inside the app itself, not by Supabase logins.
-- These policies allow the app's anon key to read/write - normal for a small internal tool.
alter table products enable row level security;
alter table weeks enable row level security;
alter table week_items enable row level security;
alter table ads enable row level security;
alter table settings enable row level security;
alter table legacy_batches enable row level security;

create policy "allow all - products" on products for all using (true) with check (true);
create policy "allow all - weeks" on weeks for all using (true) with check (true);
create policy "allow all - week_items" on week_items for all using (true) with check (true);
create policy "allow all - ads" on ads for all using (true) with check (true);
create policy "allow all - settings" on settings for all using (true) with check (true);
create policy "allow all - legacy_batches" on legacy_batches for all using (true) with check (true);

-- ---- Seed data: your real products and starting numbers ----
insert into products (name, variant, price, cost) values
('Alice Dainty Initial Necklace','',22.00,1.00),
('Amelia Duo Huggies','',20.00,1.80),
('Ann Skinny Name Ring in 18K Gold','',22.00,1.40),
('Baguette Birthstone Bracelet','',19.00,2.60),
('Baguette Birthstone Ring','',20.00,1.40);
-- NOTE: only 5 sample rows shown here to keep this readable.
-- The full 55-product list is inserted automatically by seed_products.sql (see next file) - run that one too.

insert into legacy_batches (label, delivered, cancelled, revenue, capital, ads) values
('#1002-1195 (before this system)', 181, 10, 5820.62, 537.75, 1203.07);

insert into ads (label, amount, ad_date) values
('20 Jul - 7 Aug (Meta + TikTok)', 1203.07, '2026-08-07');
