/**
 * Billets → Google Sheets
 *
 * Lit les emails de confirmation de commande Viagogo / StubHub dans Gmail et
 * ajoute une ligne par commande dans le tableau de suivi existant, au même
 * format que les lignes saisies à la main :
 *
 *   A (match) | VENDU ? | PRIX ACHAT | PRIX VENTE | TICKETS VENDUS | DATE |
 *   ORDER ID SEATIKS/TIXSTOCK | ORDER ID VIAGOGO | COMMANDE VGG? | REMBOURSE ? |
 *   PLACES | MAIL | INFORMATIONS | ARGENT RECU? | NUM CC | … | LISTE |
 *   VIAGOGO SEND TICKET | RF LANCE
 *
 * Les colonnes sont retrouvées par leur titre en ligne 1 : l'ordre peut changer.
 * Une commande déjà présente (même ORDER ID VIAGOGO) n'est jamais ajoutée deux fois.
 */

const CONFIG = {
  // Nom de l'onglet du tableau. Vide = premier onglet du classeur.
  nomFeuille: '',
  libelleGmail: 'Billets importés',
  intervalleMinutes: 15,
  // Emails des deux plateformes pas encore traités. Seuls ceux qui ont un numéro
  // de commande et un total (les confirmations d'achat) deviennent une ligne.
  recherche: 'from:(viagogo OR stubhub) -label:"Billets importés" newer_than:1y',
};

// Valeurs mises par défaut sur une nouvelle commande, comme dans le tableau.
const VALEURS_PAR_DEFAUT = {
  'VENDU ?': 'NON',
  'PRIX VENTE': '//',
  'ORDER ID SEATIKS/TIXSTOCK': '//',
  'COMMANDE VGG?': 'OUI',
  'REMBOURSE ?': 'NON',
  'ARGENT RECU?': 'NON',
  'RF LANCE': 'NON',
};

/** Menu « Billets » dans le Google Sheet. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Billets')
    .addItem('Importer maintenant', 'importerBillets')
    .addItem('Activer l\'import automatique', 'installerDeclencheur')
    .addItem('Désactiver l\'import automatique', 'supprimerDeclencheur')
    .addToUi();
}

/** Cherche les nouveaux emails de commande et les ajoute au tableau. */
function importerBillets() {
  const verrou = LockService.getScriptLock();
  if (!verrou.tryLock(30000)) return 0;
  try {
    const feuille = obtenirFeuille_();
    const colonnes = lireEnTetes_(feuille);
    const colOrder = colonnes['ORDER ID VIAGOGO'];
    if (!colOrder) throw new Error('Colonne « ORDER ID VIAGOGO » introuvable en ligne 1.');
    const commandesConnues = valeursColonne_(feuille, colOrder);
    const libelle =
      GmailApp.getUserLabelByName(CONFIG.libelleGmail) ||
      GmailApp.createLabel(CONFIG.libelleGmail);

    const lues = [];
    const fils = GmailApp.search(CONFIG.recherche, 0, 100);
    fils.forEach(function (fil) {
      fil.getMessages().forEach(function (message) { lues.push(analyserMessage_(message)); });
    });

    // Du plus ancien au plus récent : pour une commande, c'est la confirmation
    // d'achat qui compte, pas les emails envoyés ensuite.
    lues.sort(function (a, b) { return a.recuLe - b.recuLe; });
    const commandes = lues.filter(function (c) {
      if (!c.orderId || c.prix === '' || commandesConnues.has(c.orderId)) return false;
      commandesConnues.add(c.orderId);
      return true;
    });
    commandes.forEach(function (c) { ajouterLigne_(feuille, colonnes, c); });
    // Marqués seulement une fois écrits : en cas d'erreur, ils seront repris.
    fils.forEach(function (fil) { fil.addLabel(libelle); });

    console.log(commandes.length + ' commande(s) ajoutée(s).');
    return commandes.length;
  } finally {
    verrou.releaseLock();
  }
}

/** Lance importerBillets toutes les CONFIG.intervalleMinutes minutes. */
function installerDeclencheur() {
  supprimerDeclencheur();
  ScriptApp.newTrigger('importerBillets')
    .timeBased()
    .everyMinutes(CONFIG.intervalleMinutes)
    .create();
  importerBillets();
}

function supprimerDeclencheur() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'importerBillets'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

// --- Écriture dans le tableau -----------------------------------------------

function ajouterLigne_(feuille, colonnes, c) {
  const nbCol = feuille.getLastColumn();
  const ligne = derniereLigneRemplie_(feuille, colonnes) + 1;
  const valeurs = new Array(nbCol).fill('');

  function mettre(titre, valeur) {
    if (colonnes[titre] && valeur !== '' && valeur != null) valeurs[colonnes[titre] - 1] = valeur;
  }
  Object.keys(VALEURS_PAR_DEFAUT).forEach(function (t) { mettre(t, VALEURS_PAR_DEFAUT[t]); });
  mettre('', c.evenement);
  mettre('PRIX ACHAT', c.prix);
  mettre('TICKETS VENDUS', c.quantite ? '0/' + c.quantite : '');
  mettre('DATE', c.dateEvenement);
  mettre('ORDER ID VIAGOGO', isNaN(c.orderId) ? c.orderId : Number(c.orderId));
  mettre('PLACES', c.places.texte);
  // Colonnes facultatives : une seule « BLOC ET RANG », ou « BLOC » et « RANG » séparées.
  const blocEtRang = titreQui_(colonnes, /BLOC.*RANG|RANG.*BLOC/);
  if (blocEtRang) {
    mettre(blocEtRang, [c.places.bloc, c.places.rang].filter(Boolean).join(' / '));
  } else {
    mettre(titreQui_(colonnes, /^BLOC$/), c.places.bloc);
    mettre(titreQui_(colonnes, /^RANG(ÉE|EE)?$/), c.places.rang);
  }
  mettre('MAIL', c.mail);
  mettre('INFORMATIONS', c.nom);
  mettre('NUM CC', /^\d{4}$/.test(c.carte) ? Number(c.carte) : c.carte);
  mettre('VIAGOGO SEND TICKET', c.livraison);

  // Même mise en forme et mêmes menus déroulants que la ligne du dessus.
  if (ligne > 2) {
    const modele = feuille.getRange(ligne - 1, 1, 1, nbCol);
    const cible = feuille.getRange(ligne, 1, 1, nbCol);
    modele.copyTo(cible, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    modele.copyTo(cible, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }
  feuille.getRange(ligne, 1, 1, nbCol).setValues([valeurs]);
}

/** Premier titre de colonne qui correspond, ou '' (et la colonne est ignorée). */
function titreQui_(colonnes, re) {
  return Object.keys(colonnes).filter(function (t) { return t && re.test(t); })[0] || null;
}

function obtenirFeuille_() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const feuille = CONFIG.nomFeuille
    ? classeur.getSheetByName(CONFIG.nomFeuille)
    : classeur.getSheets()[0];
  if (!feuille) throw new Error('Onglet « ' + CONFIG.nomFeuille + ' » introuvable.');
  return feuille;
}

/** { 'TITRE EN MAJUSCULES': numéro de colonne }. La colonne A sans titre (le match) est ''. */
function lireEnTetes_(feuille) {
  const titres = feuille.getRange(1, 1, 1, feuille.getLastColumn()).getDisplayValues()[0];
  const colonnes = {};
  titres.forEach(function (t, i) {
    const cle = t.replace(/\s+/g, ' ').trim().toUpperCase();
    if (!(cle in colonnes)) colonnes[cle] = i + 1;
  });
  colonnes[''] = 1;
  return colonnes;
}

function valeursColonne_(feuille, col) {
  const n = feuille.getLastRow();
  if (n < 2) return new Set();
  return new Set(
    feuille.getRange(2, col, n - 1, 1).getDisplayValues()
      .map(function (r) { return r[0].trim(); })
      .filter(Boolean)
  );
}

/**
 * Dernière ligne avec un match ou un order ID. Les colonnes à menus déroulants
 * peuvent être pré-remplies plus bas, on ne s'y fie pas.
 */
function derniereLigneRemplie_(feuille, colonnes) {
  const n = feuille.getLastRow();
  if (n < 2) return 1;
  const a = feuille.getRange(2, 1, n - 1, 1).getDisplayValues();
  const h = feuille.getRange(2, colonnes['ORDER ID VIAGOGO'], n - 1, 1).getDisplayValues();
  for (let i = n - 2; i >= 0; i--) {
    if (a[i][0].trim() || h[i][0].trim()) return i + 2;
  }
  return 1;
}

// --- Lecture d'un email -----------------------------------------------------

function analyserMessage_(message) {
  const objet = message.getSubject() || '';
  const corps = (message.getPlainBody() || '').replace(/ /g, ' ');
  const lignes = corps
    // Les champs alignés sur une même ligne (« Section: 512   Row: 3 ») sont séparés.
    .split(/\r?\n|\t| {2,}/)
    .map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
    .filter(Boolean);
  const texte = lignes.join('\n');

  const quantite = quantite_(texte);
  return {
    recuLe: message.getDate(),
    orderId: numeroCommande_(texte) || numeroCommande_(objet),
    evenement: evenement_(objet, lignes),
    prix: total_(lignes),
    quantite: quantite,
    dateEvenement: dateEvenement_(texte),
    places: places_(lignes, quantite),
    mail: adresse_(message.getTo() || ''),
    nom: nom_(lignes),
    carte: carte_(texte, lignes),
    livraison: /\binstant/i.test(texte) ? 'INSTANT' : '',
  };
}

/**
 * Valeur d'un champ « Libellé : valeur » ou « Libellé » suivi de la valeur
 * sur la ligne suivante.
 */
function valeurApres_(lignes, libelle) {
  for (let i = 0; i < lignes.length; i++) {
    if (!libelle.test(lignes[i])) continue;
    const surLaLigne = lignes[i].replace(libelle, '').replace(/^\s*[:#\-–]?\s*/, '');
    if (surLaLigne) return surLaLigne.slice(0, 200);
    if (lignes[i + 1]) return lignes[i + 1].slice(0, 200);
  }
  return '';
}

function numeroCommande_(texte) {
  const m = texte.match(
    /(?:num[ée]ro\s*de\s*commande|n[°o]\.?\s*(?:de\s*)?commande|commande\s*(?:n[°o]\.?)?|order\s*(?:number|no\.?|id)?|r[ée]f[ée]rence)\s*[:#]?\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,})\b/i
  );
  return m ? m[1] : '';
}

function evenement_(objet, lignes) {
  const champ = valeurApres_(lignes, /^(événement|évènement|event|match)\b/i);
  if (champ) return champ;
  // Ex. « Votre commande pour Coldplay est confirmée », « Your order for X is confirmed »
  const m = objet.match(/\b(?:pour|for)\s+(.+?)(?:\s+(?:est|is|a été|has been)\b|\s*[-–|]|$)/i);
  return m ? m[1].trim() : '';
}

const MOIS_ = {
  janv: 1, jan: 1, févr: 2, fevr: 2, fév: 2, feb: 2, mars: 3, mar: 3, avr: 4, apr: 4,
  mai: 5, may: 5, juin: 6, jun: 6, juil: 7, jul: 7, août: 8, aout: 8, aug: 8,
  sept: 9, sep: 9, oct: 10, nov: 11, déc: 12, dec: 12,
};
const MOIS_RE_ =
  '(janv|févr|fevr|fév|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec|' +
  'jan|feb|mar|apr|may|jun|jul|aug|sep)[a-zéû]*\\.?';

function numeroMois_(nom) {
  const n = nom.toLowerCase().replace('.', '');
  for (const cle of Object.keys(MOIS_).sort(function (a, b) { return b.length - a.length; })) {
    if (n.indexOf(cle) === 0) return MOIS_[cle];
  }
  return 0;
}

/** Date de l'événement, en vraie date (affichée jj/mm/aaaa par la colonne). */
function dateEvenement_(texte) {
  let m = texte.match(new RegExp('\\b(\\d{1,2})\\s+' + MOIS_RE_ + '\\s+(\\d{4})', 'i'));
  if (m) return new Date(Number(m[3]), numeroMois_(m[2]) - 1, Number(m[1]));
  m = texte.match(new RegExp('\\b' + MOIS_RE_ + '\\s+(\\d{1,2}),?\\s+(\\d{4})', 'i'));
  if (m) return new Date(Number(m[3]), numeroMois_(m[1]) - 1, Number(m[2]));
  m = texte.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return '';
}

function quantite_(texte) {
  const m =
    texte.match(/(?:quantit[ée]|quantity|qt[ée]|nombre de billets)\s*:?\s*(\d+)/i) ||
    texte.match(/\b(\d+)\s*(?:x\s*)?(?:billets?|tickets?|e-?tickets?)\b/i);
  return m ? Number(m[1]) : '';
}

/** Montant total payé, en nombre (ex. « 1 007,02 € » → 1007.02). */
function total_(lignes) {
  const montant = /(?:[€$£]\s?\d[\d\s.,]*\d|\d[\d\s.,]*\d?\s?(?:€|EUR|USD|GBP|\$|£))/i;
  for (let i = 0; i < lignes.length; i++) {
    if (!/\b(total|montant|amount|payé|paid)\b/i.test(lignes[i])) continue;
    const m = lignes[i].match(montant) || (lignes[i + 1] || '').match(montant);
    if (m) return enNombre_(m[0]);
  }
  return '';
}

function enNombre_(s) {
  let n = s.replace(/[^\d.,]/g, '');
  const dernier = Math.max(n.lastIndexOf(','), n.lastIndexOf('.'));
  // Le dernier séparateur suivi de 1 ou 2 chiffres est la virgule décimale.
  if (dernier >= 0 && n.length - dernier - 1 <= 2) {
    n = n.slice(0, dernier).replace(/[.,]/g, '') + '.' + n.slice(dernier + 1);
  } else {
    n = n.replace(/[.,]/g, '');
  }
  return Number(n);
}

/** « 135 / 27 / 39-40 », ou « x4 L GA » quand il n'y a ni rang ni siège. */
function places_(lignes, quantite) {
  const billets = valeurApres_(lignes, /^billets\s*:/i);
  if (/\b(bloc|section|secteur|rang|row)\b/i.test(billets)) {
    const champ = function (re) { const m = billets.match(re); return m ? m[1].trim() : ''; };
    return assemblerPlaces_(
      champ(/\b(?:bloc|section|secteur|tribune|zone)\s+([^,(]+)/i),
      champ(/\b(?:rang(?:ée)?|row)\s+([^,(]+)/i),
      champ(/\b(?:places?|si[eè]ges?|seats?)\s+([^,(]+)/i),
      quantite
    );
  }
  // Autre libellé (« Catégorie 2 », « Fosse »…) : repris tel quel, sans « (2 Billets) ».
  const libre = billets.replace(/\(\s*\d+\s*(billets?|tickets?)\s*\)/i, '').replace(/[\s,]+$/, '');
  if (libre) return assemblerPlaces_(libre, '', '', quantite);
  const section = valeurApres_(lignes, /^(section|secteur|bloc|tribune|catégorie|category|zone)\b/i);
  const rang = valeurApres_(lignes, /^(rang(ée)?|row)\b/i);
  const sieges = valeurApres_(lignes, /^(si[eè]ges?|places?|seats?)\b/i);
  return assemblerPlaces_(section, rang, sieges, quantite);
}

/** { texte: pour PLACES, bloc, rang } */
function assemblerPlaces_(section, rang, sieges, quantite) {
  const texte = !rang && !sieges
    ? (section ? (quantite ? 'x' + quantite + ' ' : '') + section : '')
    : [section, rang, plageSieges_(sieges)].filter(Boolean).join(' / ');
  return { texte: texte, bloc: section, rang: rang };
}

/** « 39, 40 » → « 39-40 » quand les sièges se suivent. */
function plageSieges_(s) {
  s = s.replace(/\s*-\s*/g, '-');
  const n = (s.match(/\d+/g) || []).map(Number);
  if (n.length < 2) return s;
  for (let i = 1; i < n.length; i++) if (n[i] !== n[i - 1] + 1) return s;
  return n[0] + '-' + n[n.length - 1];
}

function nom_(lignes) {
  const champ = valeurApres_(
    lignes,
    /^(nom d[eu] client|nom du titulaire|titulaire|nom sur le billet|nom|customer name|ticket holder|name on ticket|attendee|name)\b/i
  );
  if (champ) return champ;
  for (const l of lignes.slice(0, 15)) {
    const m =
      l.match(/^(?:bonjour|hello|hi|dear|cher|chère)\s+([^,!:]+)[,!:]?$/i) ||
      l.match(/^([A-Za-zÀ-ÿ' -]{2,40}):$/);
    if (m) return m[1].trim();
  }
  return '';
}

/** 4 derniers chiffres de la carte, sinon « Apple Pay » / « Google Pay » / « PayPal ». */
function carte_(texte, lignes) {
  const mode = valeurApres_(lignes, /^(mode de paiement|moyen de paiement|payment method)\s*:?/i);
  const portefeuille = mode.match(/\b(apple\s*pay|google\s*pay|paypal)\b/i);
  const m = texte.match(
    /(?:se terminant par|finissant par|terminant par|ending (?:in|with)|[*•xX]{4}[\s-]*|[*•]{2,})\s*(\d{4})\b/i
  );
  if (m) return m[1];
  if (portefeuille) {
    return { applepay: 'Apple Pay', googlepay: 'Google Pay', paypal: 'PayPal' }[
      portefeuille[1].toLowerCase().replace(/\s+/g, '')
    ];
  }
  return '';
}

function adresse_(destinataire) {
  const m = destinataire.match(/[^\s<>,"]+@[^\s<>,"]+/);
  return m ? m[0] : destinataire;
}
