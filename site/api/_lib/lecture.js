// Lecture gratuite d'un email d'achat, sans IA : on cherche les libellés habituels
// (« Order number », « Section », « Row », « Total »…) en français et en anglais.
// Renvoie le même objet que lireEmail() dans ia.js.

const MOIS = {
  janv: 1, jan: 1, févr: 2, fevr: 2, fév: 2, feb: 2, mars: 3, mar: 3, avr: 4, apr: 4,
  mai: 5, may: 5, juin: 6, jun: 6, juil: 7, jul: 7, août: 8, aout: 8, aug: 8,
  sept: 9, sep: 9, oct: 10, nov: 11, déc: 12, dec: 12,
};
const MOIS_RE = '(janv|févr|fevr|fév|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec|jan|feb|mar|apr|may|jun|jul|aug|sep)[a-zéû]*\\.?';

const numeroMois = nom => {
  const n = nom.toLowerCase().replace('.', '');
  const cle = Object.keys(MOIS).sort((a, b) => b.length - a.length).find(k => n.startsWith(k));
  return cle ? MOIS[cle] : 0;
};
const iso = (a, m, j) => (m >= 1 && m <= 12 && j >= 1 && j <= 31
  ? `${a}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}` : null);

/** Valeur d'un champ « Libellé : valeur », ou du libellé suivi de la valeur sur la ligne suivante. */
function valeurApres(lignes, libelle) {
  const vide = v => /^[-–\s]*$/.test(v);
  const estLibelle = l => /^[^:]{1,30}:/.test(l);
  for (let i = 0; i < lignes.length; i++) {
    if (!libelle.test(lignes[i])) continue;
    const surLaLigne = lignes[i].replace(libelle, '').replace(/^\(s\)/i, '').replace(/^\s*[:#\-–]?\s*/, '');
    if (surLaLigne) return vide(surLaLigne) ? '' : surLaLigne.slice(0, 200);
    const suivante = lignes[i + 1] || '';
    return vide(suivante) || estLibelle(suivante) ? '' : suivante.slice(0, 200);
  }
  return '';
}

function numeroCommande(texte) {
  const m = texte.match(
    /(?:num[ée]ro\s*de\s*commande|n[°o]\.?\s*(?:de\s*)?commande|commande\s*(?:n[°o]\.?)?|order\s*(?:number|no\.?|id|#)?|r[ée]f[ée]rence|confirmation\s*(?:number|no\.?|#)?)\s*[:#]?\s*#?\s*((?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]{4,})\b/i
  );
  return m ? m[1] : null;
}

function dateEvenement(texte) {
  let m = texte.match(new RegExp('\\b(\\d{1,2})(?:er|st|nd|rd|th)?\\s+' + MOIS_RE + ',?\\s+(\\d{4})', 'i'));
  if (m) return iso(m[3], numeroMois(m[2]), Number(m[1]));
  m = texte.match(new RegExp('\\b' + MOIS_RE + '\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})', 'i'));
  if (m) return iso(m[3], numeroMois(m[1]), Number(m[2]));
  m = texte.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return iso(m[1], Number(m[2]), Number(m[3]));
  m = texte.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
  if (!m) return null;
  // 10/24/2026 est forcément américain ; sinon jour/mois.
  return Number(m[2]) > 12 ? iso(m[3], Number(m[1]), Number(m[2])) : iso(m[3], Number(m[2]), Number(m[1]));
}

function evenement(objet, lignes) {
  const champ = valeurApres(lignes, /^(événement|évènement|event|match|spectacle|concert)\s*:/i);
  if (champ) return champ;
  // StubHub : « Saturday, October 24, 2026 | 18:30 » puis le nom de l'événement.
  for (let i = 0; i < lignes.length - 1; i++) {
    if (/\|\s*\d{1,2}[:h]\d{2}/.test(lignes[i]) && dateEvenement(lignes[i])) return lignes[i + 1];
  }
  // « Votre commande pour Coldplay est confirmée », « You got tickets to X », « Your order for X ».
  const m = objet.match(/\b(?:pour|for|to)\s+(.+?)(?:\s+(?:est|is|a été|has been|are)\b|\s*[-–|!]|$)/i);
  if (m && !/^(your|votre)\b/i.test(m[1])) return m[1].trim();
  // Sinon, la ligne juste avant la date (Ticketmaster), en sautant la salle.
  const avant = avantLaDate(lignes);
  return avant.evenement;
}

const SALLE = /\b(stad(e|ium|ion)|arena|aréna|hall|park|parc|cent(re|er)|th[ée][aâ]t(re|er)|dome|field|ground|garden|zénith|zenith|olympia|bowl|amphi|salle|o2)\b|,/i;
const PAS_UN_TITRE = /\b(order|commande|achat|purchase)\b|^(hi|hello|bonjour|dear)\b|:$/i;

/** { evenement, lieu } : les lignes juste avant la date de l'événement. */
function avantLaDate(lignes) {
  for (let i = 1; i < Math.min(lignes.length, 60); i++) {
    if (!dateEvenement(lignes[i])) continue;
    const juste = lignes[i - 1];
    if (PAS_UN_TITRE.test(juste) || juste.length > 120) continue;
    if (SALLE.test(juste) && i >= 2 && !PAS_UN_TITRE.test(lignes[i - 2])) return { evenement: lignes[i - 2], lieu: juste };
    return { evenement: juste, lieu: null };
  }
  return { evenement: null, lieu: null };
}

function quantite(texte) {
  const m = texte.match(/(?:quantit[ée]|quantity|qt[ée]|qty|nombre de billets|number of tickets)\s*:?\s*(\d+)/i)
    || texte.match(/\b(\d+)\s*(?:x\s*)?(?:billets?|tickets?|e-?tickets?|places?)\b/i)
    || texte.match(/\b(\d+)\s*x\s+[^\n]{0,40}\b(?:billets?|tickets?|admissions?)\b/i)
    || texte.match(/\bx\s?(\d+)\b/i);
  const n = m ? Number(m[1]) : null;
  return n && n < 100 ? n : null;
}

function enNombre(s) {
  let n = s.replace(/[^\d.,]/g, '');
  const dernier = Math.max(n.lastIndexOf(','), n.lastIndexOf('.'));
  // Le dernier séparateur suivi de 1 ou 2 chiffres est la virgule décimale.
  if (dernier >= 0 && n.length - dernier - 1 <= 2) n = n.slice(0, dernier).replace(/[.,]/g, '') + '.' + n.slice(dernier + 1);
  else n = n.replace(/[.,]/g, '');
  return Number(n);
}

const MONTANT = /(?:(?:US|CA|AU)?[€$£]\s?\d[\d\s.,]*\d|\d[\d\s.,]*\d?\s?(?:€|EUR|USD|GBP|CHF|CAD|\$|£))/i;

/** { montant, zone } : le montant total payé et le texte autour (pour la devise). */
function total(lignes) {
  const libelles = [
    /\b(order total|grand total|total (payé|à payer|ttc|paid|charged)|montant total|total amount|amount paid|total charged)\b/i,
    /^total\b(?!\s*(fees|frais|tax))/i,
  ];
  for (const libelle of libelles) {
    for (let i = 0; i < lignes.length; i++) {
      if (!libelle.test(lignes[i])) continue;
      const zone = lignes[i] + ' ' + (lignes[i + 1] || '');
      const m = lignes[i].match(MONTANT) || (lignes[i + 1] || '').match(MONTANT);
      if (m) return { montant: enNombre(m[0]), zone };
    }
  }
  return { montant: null, zone: '' };
}

function devise(zone, texte, de) {
  const z = zone || texte;
  if (/£|GBP/.test(z)) return 'GBP';
  if (/€|EUR/.test(z)) return 'EUR';
  if (/CHF/.test(z)) return 'CHF';
  if (/CA\$|CAD/.test(z)) return 'CAD';
  if (/\$|USD/.test(z)) return 'USD';
  if (/ticketmaster\.co\.uk/i.test(de)) return 'GBP';
  if (/ticketmaster\.com\b/i.test(de)) return 'USD';
  return 'EUR';
}

/** « 39, 40 » → « 39-40 » quand les sièges se suivent. */
function plageSieges(s) {
  if (!s) return null;
  s = s.replace(/\s*(?:-|–|to|à|au)\s*/g, '-').replace(/\s+/g, ' ').trim();
  const n = (s.match(/\d+/g) || []).map(Number);
  if (n.length < 2 || /[a-z]/i.test(s.replace(/-/g, ''))) return s;
  for (let i = 1; i < n.length; i++) if (n[i] !== n[i - 1] + 1) return s;
  return n[0] + '-' + n[n.length - 1];
}

const nettoyer = v => (v || '').replace(/\(\s*\d+\s*(billets?|tickets?)\s*\)/i, '').replace(/^[\s,:#-]+|[\s,;.]+$/g, '').trim() || null;

/** { bloc, rang, sieges } : champs sur leur propre ligne, ou écrits à la suite (« Sec 112, Row 5, Seats 1-2 »). */
function places(lignes, texte) {
  const BLOC = /^(section|sec\.?|secteur|bloc|block|tribune|catégorie|category|cat\.?|zone|area)\b/i;
  const RANG = /^(rang(ée)?|row)\b/i;
  const SIEGES = /^(si[eè]ges?|places?|seats?)\b/i;
  let bloc = valeurApres(lignes, BLOC);
  let rang = valeurApres(lignes, RANG);
  let sieges = valeurApres(lignes, SIEGES);
  // Champs sur une même ligne : on coupe chaque valeur au libellé suivant.
  const suivant = '(?=\\s*[,|•·/]|\\s+(?:rang|row|si[eè]ges?|seats?|places?|section|sec|bloc|block)\\b|$)';
  const enLigne = re => { const m = texte.match(new RegExp(re + '\\s*[:#]?\\s*([^\\n,|•·]+?)' + suivant, 'im')); return m ? m[1] : ''; };
  const coupe = v => v.split(/\s*[,|•·]\s*|\s+(?=(?:rang|row|si[eè]ges?|seats?|places?)\b)/i)[0];
  if (!bloc || /\b(rang|row|seats?)\b/i.test(bloc)) bloc = enLigne('\\b(?:section|sec\\.?|bloc|block|secteur|tribune)') || coupe(bloc);
  if (!rang || /\b(seats?|si[eè]ges?)\b/i.test(rang)) rang = enLigne('\\b(?:rang(?:ée)?|row)') || coupe(rang);
  // Tous les numéros de sièges, même sur plusieurs lignes (« Seat 7 », « Seat 8 », « Places 39, 40 »).
  const tous = [...texte.matchAll(/\b(?:si[eè]ges?|seats?|places?)\s*[:#]?\s*(\d+[A-Z]?(?:\s*(?:,|-|–|&|and|et|to|à|au)\s*\d+[A-Z]?)*)/gi)].map(m => m[1]);
  if (tous.length > 1) sieges = tous.join(', ');
  else if (tous.length && (!sieges || /,/.test(tous[0]))) sieges = tous[0];
  if (!sieges) sieges = enLigne('\\b(?:si[eè]ges?|seats?|places?)');
  // Viagogo : « Billets : Bloc 135, Rang 27, Places 39-40 (2 Billets) ».
  const billets = valeurApres(lignes, /^billets\s*:/i);
  if (!bloc && billets && !/\b(rang|row)\b/i.test(billets)) bloc = billets;
  bloc = nettoyer(bloc); rang = nettoyer(rang);
  sieges = nettoyer(sieges);
  if (sieges && !/\d/.test(sieges)) sieges = null;
  if (rang && rang.length > 10) rang = null;
  return { bloc: bloc && bloc.length <= 60 ? bloc : null, rang, sieges: plageSieges(sieges) };
}

/** « 39-40 » → 2, « 7, 9 » → 2. */
function nombreDeSieges(sieges) {
  if (!sieges) return null;
  const plage = sieges.match(/^(\d+)-(\d+)$/);
  if (plage) return Number(plage[2]) - Number(plage[1]) + 1;
  return (sieges.match(/\d+/g) || []).length || null;
}

function nom(lignes) {
  const champ = valeurApres(lignes,
    /^(nom d[eu] client|nom du titulaire|titulaire|nom sur le billet|nom|customer name|ticket holder|name on ticket|attendee|name)\b/i);
  if (champ) return champ;
  for (const l of lignes.slice(0, 15)) {
    const m = l.match(/^(?:bonjour|hello|hi|dear|cher|chère)\s+([^,!:]+)[,!:]?$/i);
    if (m) return m[1].trim();
  }
  return null;
}

/** 4 derniers chiffres de la carte, sinon « Apple Pay » / « Google Pay » / « PayPal ». */
function paiement(texte) {
  const m = texte.match(/(?:se terminant par|finissant par|terminant par|ending (?:in|with)|[*•xX]{4}[\s-]*|[*•]{2,})\s*(\d{4})\b/i);
  if (m) return m[1];
  const p = texte.match(/\b(apple\s*pay|google\s*pay|paypal)\b/i);
  return p ? { applepay: 'Apple Pay', googlepay: 'Google Pay', paypal: 'PayPal' }[p[1].toLowerCase().replace(/\s+/g, '')] : null;
}

const SITES = [[/ticketmaster/i, 'Ticketmaster'], [/viagogo/i, 'Viagogo'], [/stubhub/i, 'StubHub'], [/axs/i, 'AXS'], [/fnac/i, 'Fnac Spectacles'], [/see ?tickets/i, 'See Tickets']];

// Emails à ne pas prendre pour un achat : billets prêts, rappels, ventes, publicités.
const PAS_UN_ACHAT = /tickets? (are|is) (ready|now available)|billets? (sont|est) (prêts?|disponibles?)|reminder|rappel|you sold|vous avez vendu|sale confirmed|vente confirmée|newsletter|presale|prévente|on sale|unsubscribe from|password|mot de passe|transfer(red)?|transféré|refund|rembours/i;
const ACHAT = /confirm|commande|order|purchase|achat|merci|thank|you got|got (the )?tickets|receipt|reçu/i;

export function lireEmailSansIA({ de = '', objet = '', corps = '' }) {
  const brut = String(corps).replace(/\u00a0/g, ' ').replace(/\r/g, '');
  const lignes = brut
    // Les champs alignés sur une même ligne (« Section: 512   Row: 3 ») sont séparés.
    .split(/\n|\t| {2,}/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const texte = lignes.join('\n');
  const site = (SITES.find(([re]) => re.test(de) || re.test(objet)) || [null, 'Autre'])[1];
  const numero = numeroCommande(texte) || numeroCommande(objet);
  const { montant, zone } = total(lignes);
  const lesPlaces = places(lignes, texte);
  const estAchat = !!numero && ACHAT.test(objet + ' ' + texte.slice(0, 2000)) && !PAS_UN_ACHAT.test(objet);
  return {
    est_achat: estAchat,
    site,
    numero_commande: numero,
    evenement: evenement(objet, lignes),
    lieu: valeurApres(lignes, /^(lieu|venue|salle|stade|stadium|location)\s*:/i) || avantLaDate(lignes).lieu,
    date_evenement: dateEvenement(texte),
    ...lesPlaces,
    quantite: quantite(texte) || nombreDeSieges(lesPlaces.sieges),
    prix_total: montant,
    devise: devise(zone, texte, de),
    nom_client: nom(lignes),
    paiement: paiement(texte),
    annulation_probable: /further email from us|recevrez un autre e-?mail/i.test(texte),
  };
}
