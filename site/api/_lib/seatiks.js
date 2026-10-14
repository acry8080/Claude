// Appels à l'API Seatiks (https://api.seatiks.com/v1) avec la clé SEATIKS_API_KEY.

const BASE = 'https://api.seatiks.com/v1';

export const ANNONCE = {
  transfer_method: 'E-ticket',
  split_type: 'All together',
  price_currency: 'EUR',
  // Pas de « platforms » : l'annonce est publiée sur toutes les plateformes.
};

export class ErreurSeatiks extends Error {
  constructor(statut, code, message) {
    super(`Seatiks ${statut}${code ? ' ' + code : ''} : ${message || ''}`.trim());
    this.statut = statut;
    this.code = code;
  }
}

export const seatiksConfigure = () => !!(process.env.SEATIKS_API_KEY || '').trim();

export async function appel(chemin, methode = 'GET', corps) {
  const r = await fetch(BASE + chemin, {
    method: methode,
    headers: {
      Authorization: 'Bearer ' + (process.env.SEATIKS_API_KEY || '').trim(),
      ...(corps ? { 'Content-Type': 'application/json' } : {}),
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = json.error || {};
    throw new ErreurSeatiks(r.status, e.code, e.message);
  }
  return json;
}

/** Toutes les pages d'une liste Seatiks ({ data, has_more, next_cursor }). */
export async function tout(chemin, maxPages = 20) {
  const resultats = [];
  let curseur = '';
  for (let p = 0; p < maxPages; p++) {
    const page = await appel(chemin + (chemin.includes('?') ? '&' : '?') + 'limit=200' + (curseur ? '&cursor=' + encodeURIComponent(curseur) : ''));
    resultats.push(...(page.data || []));
    if (!page.has_more) break;
    curseur = page.next_cursor;
  }
  return resultats;
}

// --- Rapprochement des noms ---------------------------------------------------

const MOTS_VIDES = ['vs', 'fc', 'sv', 'the', 'and', 'les', 'des', 'club', 'stadium', 'stade', 'tour'];

/** Mots en minuscules sans accents : « 1. FC Köln » → ['koln']. */
export function motsCles(texte, garderCourts = false) {
  return String(texte || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(m => m && (garderCourts || m.length >= 3 || /\d/.test(m)) && (garderCourts || !MOTS_VIDES.includes(m)));
}

const SYNONYMES = { categorie: 'category', cat: 'category', fosse: 'pit', pelouse: 'floor' };
const MOTS_SECTION = ['bloc', 'block', 'section', 'secteur', 'tribune', 'zone', 'sec', 'sect'];
const motsSection = t => motsCles(t, true).map(m => SYNONYMES[m] || m).filter(m => !MOTS_SECTION.includes(m));

/**
 * Les événements Seatiks du même jour qui ressemblent le plus au nom.
 * Renvoie { trouve } s'il n'y en a qu'un, sinon { options } pour laisser choisir.
 */
export async function chercherEvenement(nom, date) {
  if (!date) return { options: [], raison: 'Date de l\'événement manquante.' };
  const jour = new Date(date + 'T00:00:00Z').getTime();
  const debut = new Date(jour - 864e5).toISOString();
  const fin = new Date(jour + 2 * 864e5).toISOString();
  const evenements = await tout(`/events?listable=true&date_from=${encodeURIComponent(debut)}&date_to=${encodeURIComponent(fin)}`, 10);
  const mots = motsCles(nom);
  const notes = evenements
    .map(ev => ({ ev, score: motsCles(ev.name).filter(m => mots.includes(m)).length }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const options = (notes.length ? notes.map(x => x.ev) : evenements).slice(0, 15)
    .map(ev => ({ id: ev.id, nom: ev.name, date: ev.start_date, lieu: [ev.venue, ev.city].filter(Boolean).join(', ') }));
  if (notes.length && (notes.length === 1 || notes[0].score > notes[1].score)) return { trouve: options[0] };
  return { options, raison: notes.length ? 'Plusieurs événements possibles sur Seatiks.' : 'Événement introuvable sur Seatiks à cette date.' };
}

/**
 * La section Seatiks qui correspond au bloc (« 13C » → « Block 13C »).
 * Renvoie { trouve } ou { options } (toutes les sections de l'événement).
 */
export async function chercherSection(eventId, bloc) {
  const sections = (await appel('/events/' + encodeURIComponent(eventId))).sections || [];
  const options = sections.map(s => ({ key: s.key, nom: [s.name, s.category].filter(Boolean).join(' · ') || s.key, name: s.name, category: s.category }));
  const cherche = motsSection(bloc);
  if (!cherche.length) return { options, raison: 'Bloc vide.' };
  const exactes = sections.filter(s => s.key === bloc || motsSection(s.name).join(' ') === cherche.join(' '));
  if (exactes.length === 1) return { trouve: options[sections.indexOf(exactes[0])] };
  const avecChiffres = cherche.filter(m => /\d/.test(m));
  const requis = avecChiffres.length ? avecChiffres : cherche;
  const proches = sections.filter(s => {
    const mots = motsSection((s.name || '') + ' ' + (s.category || ''));
    return requis.every(m => mots.includes(m));
  });
  if (proches.length === 1) return { trouve: options[sections.indexOf(proches[0])] };
  return { options, raison: proches.length ? `Plusieurs sections possibles pour « ${bloc} ».` : `Section introuvable pour « ${bloc} ».` };
}
