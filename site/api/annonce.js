import { exigerSession } from './_lib/auth.js';
import { db, echec, ok } from './_lib/db.js';
import { ANNONCE, ErreurSeatiks, appel, chercherEvenement, chercherSection, seatiksConfigure } from './_lib/seatiks.js';

// POST { id, prix, event_id?, section_key? }
//   prix > 0 : crée l'annonce Seatiks, ou change son prix (et la republie si elle était retirée)
//   prix vide : retire l'annonce de la vente
// Réponse 409 { choix: { type: 'evenement' | 'section', options, raison } } quand il faut choisir.
export default async function handler(req, res) {
  if (!exigerSession(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  if (!seatiksConfigure()) return res.status(400).json({ erreur: 'SEATIKS_API_KEY manquant dans les variables Vercel.' });
  const { id, prix, event_id, section_key } = req.body || {};
  try {
    const [c] = ok(await db().from('commandes').select('*, ventes(*)').eq('id', id));
    if (!c) return res.status(404).json({ erreur: 'Commande introuvable.' });
    const maj = champs => db().from('commandes').update(champs).eq('id', c.id).then(ok);

    if (prix === null || prix === '' || prix === undefined) {
      if (c.annonce_id && c.annonce_active) await appel(`/listings/${encodeURIComponent(c.annonce_id)}/unpublish`, 'POST');
      await maj({ annonce_active: false });
      return res.json({ message: 'Annonce retirée de la vente sur Seatiks.' });
    }
    const p = Number(prix);
    if (!(p > 0)) return res.status(400).json({ erreur: 'Prix illisible : écrivez un nombre, par exemple 250.' });

    if (c.annonce_id) {
      await appel(`/listings/${encodeURIComponent(c.annonce_id)}`, 'PATCH', { price: p });
      if (!c.annonce_active) await appel(`/listings/${encodeURIComponent(c.annonce_id)}/publish`, 'POST');
      await maj({ annonce_prix: p, annonce_active: true });
      return res.json({ message: `Annonce Seatiks à jour : ${p} € par billet.` });
    }

    // Nouvelle annonce
    const vendus = (c.ventes || []).filter(v => !v.annulee).reduce((s, v) => s + v.quantite, 0);
    const reste = c.quantite - vendus;
    if (reste <= 0) return res.status(400).json({ erreur: 'Tous les billets de cette commande sont vendus.' });
    if (c.rembourse || c.annulation_probable) return res.status(400).json({ erreur: 'Commande remboursée ou probablement annulée : pas de mise en vente.' });
    if (!c.bloc || (!c.placement_libre && (!c.rang || !c.sieges))) return res.status(400).json({ erreur: 'Complétez d\'abord le bloc, le rang et les sièges (ou cochez « Placement libre »).' });

    let eventId = event_id || c.seatiks_event_id;
    if (!eventId) {
      const r = await chercherEvenement(c.evenement, c.date_evenement);
      if (!r.trouve) return res.status(409).json({ choix: { type: 'evenement', options: r.options, raison: r.raison } });
      eventId = r.trouve.id;
    }
    if (eventId !== c.seatiks_event_id) await maj({ seatiks_event_id: eventId, seatiks_section_key: null, seatiks_section_nom: null });

    let section = section_key && c.seatiks_section_key === section_key ? { key: c.seatiks_section_key, nom: c.seatiks_section_nom } : null;
    if (!section && c.seatiks_section_key && !section_key && eventId === c.seatiks_event_id) section = { key: c.seatiks_section_key, nom: c.seatiks_section_nom };
    if (!section) {
      const r = await chercherSection(eventId, c.bloc);
      section = section_key ? r.options.find(o => o.key === section_key) : r.trouve;
      if (!section) return res.status(409).json({ choix: { type: 'section', options: r.options, raison: r.raison } });
    }
    await maj({ seatiks_section_key: section.key, seatiks_section_nom: section.nom });

    const item = {
      event_id: eventId,
      section: section.key,
      quantity: reste,
      price: p,
      internal_note: `RB-${c.id.slice(0, 8)} · ${c.site} ${c.numero}`.slice(0, 500),
      idempotency_key: `rb-${c.id}`,
      ...ANNONCE,
    };
    const rang = (c.rang || '').replace(/[^A-Za-z0-9/-]/g, '').slice(0, 20);
    if (!c.placement_libre && rang) {
      item.row = rang;
      const siege = ((c.sieges || '').match(/[A-Za-z0-9]+/) || [''])[0].slice(0, 10);
      if (siege) item.first_seat = siege;
    } else {
      item.hide_seats = true;
    }

    const resultat = ((await appel('/listings', 'POST', { listings: [item] })).data || [])[0] || {};
    const annonceId = resultat.id || (resultat.listing && resultat.listing.id);
    if (['created', 'duplicate', 'pending_approval'].includes(resultat.status)) {
      if (annonceId) await maj({ annonce_id: annonceId, annonce_prix: p, annonce_active: true });
      return res.json({
        message: resultat.status === 'pending_approval'
          ? 'Annonce envoyée : Seatiks doit la valider.'
          : `Annonce publiée sur Seatiks : section ${section.nom}, ${reste} billet(s) à ${p} €.`,
      });
    }
    const err = resultat.error || {};
    const motif = err.code === 'rejected'
      ? ' Tant que votre compte Seatiks a moins de 5 ventes, il faut lister depuis le site Seatiks, avec la preuve d\'achat.'
      : '';
    res.status(400).json({ erreur: `Seatiks a refusé l'annonce : ${err.message || err.code || resultat.status || 'raison inconnue'}.${motif}` });
  } catch (e) {
    echec(res, e, e instanceof ErreurSeatiks ? 502 : 500);
  }
}
