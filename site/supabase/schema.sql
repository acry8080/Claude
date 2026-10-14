-- Revente Billets : à coller une fois dans Supabase → SQL Editor → Run.

create table if not exists commandes (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  site text not null,
  numero text not null,
  evenement text,
  lieu text,
  date_evenement date,
  bloc text,
  rang text,
  sieges text,
  placement_libre boolean not null default false,
  auto jsonb not null default '{}'::jsonb,          -- infos lues dans l'email (bloc, rang, sieges : true/false)
  quantite integer not null default 1,
  prix numeric,                                       -- dans la devise d'achat
  devise text not null default 'EUR',
  prix_eur numeric,                                   -- converti en euros
  achete_le date,
  email_destinataire text,
  nom text,
  paiement text,
  annulation_probable boolean not null default false,
  rembourse boolean not null default false,
  seatiks_event_id text,
  seatiks_section_key text,
  seatiks_section_nom text,
  annonce_id text,
  annonce_prix numeric,
  annonce_active boolean not null default false,
  unique (site, numero)
);

create table if not exists ventes (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  commande_id uuid references commandes (id) on delete set null,
  source text not null default 'seatiks',             -- seatiks | manuel
  seatiks_id text unique,
  short_id text,
  listing_id text,
  evenement text,                                     -- pour les ventes pas encore rattachées
  le date not null default current_date,
  quantite integer not null default 1,
  montant numeric not null default 0,                 -- ce que vous recevez
  devise text not null default 'EUR',
  plateforme text,
  paye boolean not null default false,
  livre boolean not null default false,
  annulee boolean not null default false
);

create table if not exists frais (
  id uuid primary key default gen_random_uuid(),
  le date not null default current_date,
  libelle text not null,
  montant numeric not null
);

create table if not exists emails (
  id uuid primary key default gen_random_uuid(),
  recu_le timestamptz not null default now(),
  message_id text unique not null,
  de text,
  a text,
  objet text,
  statut text not null,                               -- commande | ignore | erreur
  detail text,
  resultat jsonb,
  commande_id uuid references commandes (id) on delete set null
);

create table if not exists reglages (
  cle text primary key,
  valeur text
);

-- Personne d'autre que le serveur du site ne lit ces tables.
alter table commandes enable row level security;
alter table ventes enable row level security;
alter table frais enable row level security;
alter table emails enable row level security;
alter table reglages enable row level security;
