import { exigerSession } from './_lib/auth.js';
import { db, echec, lireReglage, ok } from './_lib/db.js';
import { seatiksConfigure } from './_lib/seatiks.js';

// Tout ce qu'affiche le site, en une requête.
export default async function handler(req, res) {
  if (!exigerSession(req, res)) return;
  try {
    const [commandes, frais, orphelines, dernierEmail, derniereSync] = await Promise.all([
      db().from('commandes').select('*, ventes(*)').order('date_evenement', { ascending: true }).then(ok),
      db().from('frais').select('*').order('le', { ascending: false }).then(ok),
      db().from('ventes').select('*').is('commande_id', null).eq('annulee', false).order('le', { ascending: false }).then(ok),
      lireReglage('dernier_email'),
      lireReglage('derniere_sync'),
    ]);
    res.json({ commandes, frais, orphelines, infos: { seatiks: seatiksConfigure(), dernier_email: dernierEmail, derniere_sync: derniereSync } });
  } catch (e) {
    echec(res, e);
  }
}
