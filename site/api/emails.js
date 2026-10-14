import Anthropic from '@anthropic-ai/sdk';
import { estLeScript } from './_lib/auth.js';
import { db, echec, ecrireReglage, ok } from './_lib/db.js';
import { enEuros } from './_lib/devises.js';
import { lireEmail } from './_lib/ia.js';
import { lireEmailSansIA } from './_lib/lecture.js';

// Sans clé Anthropic, les emails sont lus gratuitement, sans IA.
const avecIA = () => !!(process.env.ANTHROPIC_API_KEY || '').trim();

const SITES = [[/ticketmaster/i, 'Ticketmaster'], [/viagogo/i, 'Viagogo'], [/stubhub/i, 'StubHub'], [/axs/i, 'AXS'], [/fnac/i, 'Fnac Spectacles'], [/see ?tickets/i, 'See Tickets']];
const nomSite = (s, de) => (SITES.find(([re]) => re.test(s || '') || re.test(de || '')) || [null, (s || 'Autre').trim()])[1];
const PLACEMENT_LIBRE = /\b(fosse|pit|pelouse|floor|general admission|ga|debout|standing|stehplatz)\b/i;
const adresse = a => ((a || '').match(/[^\s<>,"]+@[^\s<>,"]+/) || [a || ''])[0];
const dateOuNull = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null);
// Les erreurs passagères de l'IA : on répond 503 pour que le script Gmail réessaie plus tard.
const passagere = e => e instanceof Anthropic.APIConnectionError || (e instanceof Anthropic.APIError && (e.status === 429 || e.status >= 500));

// POST { message_id, de, a, objet, date, corps } envoyé par le script Gmail (en-tête x-cle-site).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!estLeScript(req)) return res.status(401).json({ erreur: 'Clé du script incorrecte (CLE_SCRIPT).' });
  const { message_id, de, a, objet, date, corps } = req.body || {};
  if (!message_id || !corps) return res.status(400).json({ erreur: 'message_id et corps obligatoires.' });

  try {
    const [deja] = ok(await db().from('emails').select('statut, commande_id').eq('message_id', message_id));
    if (deja) return res.json({ deja: true, ...deja });

    const noter = (statut, extra) => db().from('emails').insert({ message_id, de, a, objet, statut, ...extra }).then(ok);
    let lu;
    try {
      const email = { de, a, objet, date, corps: String(corps).slice(0, 100000) };
      lu = avecIA() ? await lireEmail(email) : lireEmailSansIA(email);
    } catch (e) {
      if (passagere(e)) return res.status(503).json({ erreur: 'IA indisponible, réessai plus tard : ' + e.message });
      await noter('erreur', { detail: e.message });
      return res.json({ statut: 'erreur', detail: e.message });
    }

    if (!lu.est_achat || !lu.numero_commande) {
      await noter('ignore', { resultat: lu });
      return res.json({ statut: 'ignore' });
    }

    const site = nomSite(lu.site, de);
    const numero = String(lu.numero_commande).trim();
    const [existante] = ok(await db().from('commandes').select('*').eq('site', site).eq('numero', numero));
    let commande = existante;
    if (!existante) {
      const acheteLe = dateOuNull((date || '').slice(0, 10)) || new Date().toISOString().slice(0, 10);
      const devise = (lu.devise || 'EUR').toUpperCase();
      const libre = !!lu.bloc && !lu.rang && PLACEMENT_LIBRE.test(lu.bloc);
      [commande] = ok(await db().from('commandes').insert({
        site, numero,
        evenement: lu.evenement, lieu: lu.lieu, date_evenement: dateOuNull(lu.date_evenement),
        bloc: lu.bloc, rang: lu.rang, sieges: lu.sieges, placement_libre: libre,
        auto: { bloc: !!lu.bloc, rang: !!lu.rang, sieges: !!lu.sieges },
        quantite: lu.quantite || 1,
        prix: lu.prix_total, devise, prix_eur: await enEuros(lu.prix_total, devise, acheteLe),
        achete_le: acheteLe,
        email_destinataire: adresse(a), nom: lu.nom_client, paiement: lu.paiement,
        annulation_probable: !!lu.annulation_probable,
      }).select());
    }
    await noter('commande', { resultat: lu, commande_id: commande.id });
    await ecrireReglage('dernier_email', new Date().toISOString());
    res.json({ statut: 'commande', nouvelle: !existante, commande_id: commande.id });
  } catch (e) {
    echec(res, e);
  }
}
