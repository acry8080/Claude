import { exigerSession } from './_lib/auth.js';
import { db, echec, ok } from './_lib/db.js';

// Champs qu'on peut corriger depuis la fiche d'un billet.
const MODIFIABLES = ['evenement', 'lieu', 'date_evenement', 'bloc', 'rang', 'sieges', 'placement_libre', 'quantite',
  'prix', 'prix_eur', 'rembourse', 'annulation_probable', 'seatiks_event_id', 'seatiks_section_key', 'seatiks_section_nom'];

// PATCH { id, ...champs }  ·  DELETE ?id=
export default async function handler(req, res) {
  if (!exigerSession(req, res)) return;
  try {
    if (req.method === 'DELETE') {
      ok(await db().from('commandes').delete().eq('id', req.query.id));
      return res.json({ ok: true });
    }
    if (req.method !== 'PATCH') return res.status(405).end();
    const { id, ...champs } = req.body || {};
    const [avant] = ok(await db().from('commandes').select('*').eq('id', id));
    if (!avant) return res.status(404).json({ erreur: 'Commande introuvable.' });

    const maj = {};
    for (const k of MODIFIABLES) if (k in champs) maj[k] = champs[k] === '' ? null : champs[k];
    // Une place corrigée à la main n'est plus « lue dans l'email ».
    const auto = { ...(avant.auto || {}) };
    for (const k of ['bloc', 'rang', 'sieges']) if (k in maj && (maj[k] || null) !== (avant[k] || null)) auto[k] = false;
    maj.auto = auto;
    // Nouveau bloc : la section Seatiks trouvée avant ne vaut plus.
    if ('bloc' in maj && maj.bloc !== avant.bloc && !('seatiks_section_key' in champs)) {
      maj.seatiks_section_key = null;
      maj.seatiks_section_nom = null;
    }
    const [apres] = ok(await db().from('commandes').update(maj).eq('id', id).select());
    res.json({ commande: apres });
  } catch (e) {
    echec(res, e);
  }
}
