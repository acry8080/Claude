import { exigerSession } from './_lib/auth.js';
import { db, echec, ok } from './_lib/db.js';

// POST { action, ... } :
//   manuelle  { commande_id, quantite, montant }  vente faite hors Seatiks
//   payer     { id, paye }                         argent reçu ou non
//   livrer    { id, livre }                        billets envoyés ou non
//   rattacher { id, commande_id }                  relier une vente Seatiks à sa commande
//   supprimer { id }                               seulement une vente manuelle
export default async function handler(req, res) {
  if (!exigerSession(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    if (b.action === 'manuelle') {
      if (!(Number(b.quantite) > 0) || !(Number(b.montant) >= 0)) return res.status(400).json({ erreur: 'Quantité et montant obligatoires.' });
      const [v] = ok(await db().from('ventes').insert({ commande_id: b.commande_id, source: 'manuel', quantite: Number(b.quantite), montant: Number(b.montant), plateforme: 'Manuel' }).select());
      return res.json({ vente: v });
    }
    const champs = { payer: { paye: !!b.paye }, livrer: { livre: !!b.livre }, rattacher: { commande_id: b.commande_id || null } }[b.action];
    if (champs) {
      const [v] = ok(await db().from('ventes').update(champs).eq('id', b.id).select());
      return res.json({ vente: v });
    }
    if (b.action === 'supprimer') {
      ok(await db().from('ventes').delete().eq('id', b.id).eq('source', 'manuel'));
      return res.json({ ok: true });
    }
    res.status(400).json({ erreur: 'Action inconnue.' });
  } catch (e) {
    echec(res, e);
  }
}
