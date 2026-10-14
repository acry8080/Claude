import { createClient } from '@supabase/supabase-js';

let client;

/** Client Supabase côté serveur (clé service_role : jamais envoyée au navigateur). */
export function db() {
  if (!client) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans les variables Vercel.');
    }
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}

/** Renvoie les données d'une requête Supabase, ou lève son erreur. */
export function ok({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export async function lireReglage(cle) {
  const lignes = ok(await db().from('reglages').select('valeur').eq('cle', cle));
  return lignes[0] ? lignes[0].valeur : null;
}

export async function ecrireReglage(cle, valeur) {
  ok(await db().from('reglages').upsert({ cle, valeur: String(valeur) }));
}

/** Réponse d'erreur commune à toutes les routes. */
export function echec(res, e, statut = 500) {
  console.error(e);
  res.status(statut).json({ erreur: e && e.message ? e.message : String(e) });
}
