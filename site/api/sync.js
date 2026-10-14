import { exigerSession } from './_lib/auth.js';
import { db, echec, ecrireReglage, lireReglage, ok } from './_lib/db.js';
import { seatiksConfigure, tout } from './_lib/seatiks.js';

const JOURS = 60;

// Récupère les ventes Seatiks et met le site à jour.
// Appelé par le script Gmail toutes les 5 minutes, ou par le bouton « Actualiser ».
export default async function handler(req, res) {
  if (!exigerSession(req, res, { scriptAutorise: true })) return;
  if (!seatiksConfigure()) return res.json({ ok: false, erreur: 'SEATIKS_API_KEY manquant.' });
  try {
    // On repart de zéro : les ventes d'avant la mise en route ne sont pas importées.
    let depuis = await lireReglage('seatiks_depuis');
    if (!depuis) {
      depuis = new Date().toISOString();
      await ecrireReglage('seatiks_depuis', depuis);
    }
    const debut = new Date(Math.max(new Date(depuis).getTime(), Date.now() - JOURS * 864e5)).toISOString();
    const ventes = await tout(`/sales?created_since=${encodeURIComponent(debut)}`);

    const ids = ventes.map(v => v.id);
    const connues = ids.length ? ok(await db().from('ventes').select('id, seatiks_id').in('seatiks_id', ids)) : [];
    const parId = new Map(connues.map(v => [v.seatiks_id, v.id]));
    const commandes = ok(await db().from('commandes').select('id, annonce_id'));
    const parAnnonce = new Map(commandes.filter(c => c.annonce_id).map(c => [c.annonce_id, c.id]));

    let ajoutees = 0, misesAJour = 0;
    for (const v of ventes) {
      const champs = {
        paye: !!v.is_paid,
        livre: v.status === 'delivered' || !!v.delivered_at,
        annulee: /^cancelled/.test(v.status || ''),
        montant: v.payout && v.payout.total_amount != null ? v.payout.total_amount : 0,
        devise: (v.payout && v.payout.currency) || 'EUR',
      };
      if (parId.has(v.id)) {
        ok(await db().from('ventes').update(champs).eq('id', parId.get(v.id)));
        misesAJour++;
        continue;
      }
      // Rattachement sûr : l'annonce a été créée depuis le site, ou sa note interne porte « RB-xxxxxxxx ».
      let commandeId = parAnnonce.get(v.listing_id) || null;
      const ref = ((v.internal_note || '').match(/RB-([0-9a-f]{8})/) || [])[1];
      if (!commandeId && ref) commandeId = (commandes.find(c => c.id.startsWith(ref)) || {}).id || null;
      ok(await db().from('ventes').insert({
        commande_id: commandeId, source: 'seatiks', seatiks_id: v.id, short_id: v.short_id, listing_id: v.listing_id,
        evenement: v.event && v.event.name, le: (v.created_at || new Date().toISOString()).slice(0, 10),
        quantite: v.quantity || 1, plateforme: v.marketplace, ...champs,
      }));
      ajoutees++;
    }
    await ecrireReglage('derniere_sync', new Date().toISOString());
    res.json({ ok: true, ajoutees, mises_a_jour: misesAJour });
  } catch (e) {
    echec(res, e);
  }
}
