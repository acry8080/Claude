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
  // Commande sans le lien « StubHub account » (email « a further email ») :
  // probablement annulée, la ligne est surlignée de cette couleur.
  couleurAnnulationProbable: '#f9cb9c',
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
    .addSeparator()
    .addItem('Tester la connexion Seatiks', 'testerSeatiks')
    .addItem('Importer les ventes Seatiks', 'importerVentesSeatiks')
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
    // Puis les ventes : une panne de Seatiks ne bloque pas l'import des achats.
    try {
      importerVentesSeatiks_();
    } catch (e) {
      console.error(e.message);
    }
    return commandes.length;
  } finally {
    verrou.releaseLock();
  }
}

/**
 * Lance importerBillets toutes les CONFIG.intervalleMinutes minutes, et
 * surModification à chaque modification du Sheet (colonne PRIX LISTING).
 */
function installerDeclencheur() {
  supprimerDeclencheur();
  ScriptApp.newTrigger('importerBillets')
    .timeBased()
    .everyMinutes(CONFIG.intervalleMinutes)
    .create();
  ScriptApp.newTrigger('surModification')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  importerBillets();
}

function supprimerDeclencheur() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return ['importerBillets', 'surModification'].indexOf(t.getHandlerFunction()) >= 0; })
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

  // Même mise en forme et mêmes menus déroulants qu'une ligne du dessus non surlignée.
  const cible = feuille.getRange(ligne, 1, 1, nbCol);
  if (ligne > 2) {
    const modele = feuille.getRange(ligneModele_(feuille, ligne), 1, 1, nbCol);
    modele.copyTo(cible, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    modele.copyTo(cible, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }
  cible.setValues([valeurs]);

  if (colonnes['PRIX ACHAT']) {
    feuille.getRange(ligne, colonnes['PRIX ACHAT'])
      .setNumberFormat(c.devise === '$' ? '"$"#,##0.00' : '#,##0.00');
  }
  if (c.annulationProbable) cible.setBackground(CONFIG.couleurAnnulationProbable);
}

/** Ligne la plus proche au-dessus dont la colonne A n'est pas colorée. */
function ligneModele_(feuille, ligne) {
  const debut = Math.max(2, ligne - 50);
  const fonds = feuille.getRange(debut, 1, ligne - debut, 1).getBackgrounds();
  for (let i = fonds.length - 1; i >= 0; i--) {
    if (fonds[i][0] === '#ffffff') return debut + i;
  }
  return ligne - 1;
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
  const corps = (message.getPlainBody() || '').replace(/\u00a0/g, ' ');
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
    devise: devise_(lignes),
    annulationProbable: /further email from us|recevrez un autre e-?mail/i.test(texte),
    quantite: quantite,
    dateEvenement: dateEvenement_(texte),
    places: places_(lignes, quantite),
    mail: adresse_(message.getTo() || ''),
    nom: nom_(lignes),
    carte: carte_(texte, lignes),
    livraison: livraison_(texte),
  };
}

/**
 * Valeur d'un champ « Libellé : valeur » ou « Libellé » suivi de la valeur
 * sur la ligne suivante.
 */
function valeurApres_(lignes, libelle) {
  const vide = function (v) { return /^[-–\s]*$/.test(v); };
  const estLibelle = function (l) { return /^[^:]{1,30}:/.test(l); };
  for (let i = 0; i < lignes.length; i++) {
    if (!libelle.test(lignes[i])) continue;
    const surLaLigne = lignes[i]
      .replace(libelle, '')
      .replace(/^\(s\)/i, '') // « Seat(s) », « Ticket(s) »
      .replace(/^\s*[:#\-–]?\s*/, '');
    if (surLaLigne) return vide(surLaLigne) ? '' : surLaLigne.slice(0, 200);
    const suivante = lignes[i + 1] || '';
    return vide(suivante) || estLibelle(suivante) ? '' : suivante.slice(0, 200);
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
  const champ = valeurApres_(lignes, /^(événement|évènement|event|match)\s*:/i);
  if (champ) return champ;
  // StubHub : « Saturday, October 24, 2026 | 18:30 » puis le nom de l'événement.
  for (let i = 0; i < lignes.length - 1; i++) {
    if (/\|\s*\d{1,2}[:h]\d{2}/.test(lignes[i]) && dateEvenement_(lignes[i])) return lignes[i + 1];
  }
  // Ex. « Votre commande pour Coldplay est confirmée », « Your order for X is confirmed »
  const m = objet.match(/\b(?:pour|for)\s+(.+?)(?:\s+(?:est|is|a été|has been)\b|\s*[-–|]|$)/i);
  return m && !/^(your|votre)\b/i.test(m[1]) ? m[1].trim() : '';
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
  const libelles = [
    /\b(order total|grand total|total (payé|à payer|ttc|paid)|montant total|total amount)\b/i,
    /^total\b(?!\s*(fees|frais))/i,
  ];
  for (const libelle of libelles) {
    for (let i = 0; i < lignes.length; i++) {
      if (!libelle.test(lignes[i])) continue;
      const m = lignes[i].match(montant) || (lignes[i + 1] || '').match(montant);
      if (m) return enNombre_(m[0]);
    }
  }
  return '';
}

/** '$' quand le total est en dollars, sinon '' (euros, format de la colonne). */
function devise_(lignes) {
  const total = lignes.filter(function (l) { return /total/i.test(l) && !/fees|frais/i.test(l); });
  const i = lignes.indexOf(total[total.length - 1]);
  const zone = i >= 0 ? lignes[i] + ' ' + (lignes[i + 1] || '') : '';
  return /\$|USD/.test(zone) ? '$' : '';
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

/**
 * INSTANT quand l'email dit que les billets sont en préparation et renvoie au
 * compte (« go to My tickets > Orders in your StubHub account », « Mon compte ») :
 * la commande est passée. L'autre email (« You will receive a further email… »)
 * annonce le plus souvent une annulation : la case reste vide.
 */
function livraison_(texte) {
  if (/further email from us|recevrez un autre e-?mail/i.test(texte)) return '';
  if (
    /\binstant/i.test(texte) ||
    /preparing your tickets|go to my tickets|in your (stubhub|viagogo) account/i.test(texte) ||
    /en train de préparer vos billets|sur mon compte/i.test(texte)
  ) return 'INSTANT';
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

// --- Ventes Seatiks ----------------------------------------------------------
//
// Toutes les 15 minutes (avec l'import des achats), le script lit les ventes des
// 60 derniers jours sur l'API Seatiks et met à jour la ligne de la commande :
// TICKETS VENDUS, VENDU ?, PRIX VENTE, ORDER ID SEATIKS/TIXSTOCK, LISTE, ARGENT RECU?.
// La clé API se met dans Paramètres du projet → Propriétés du script, sous le nom
// SEATIKS_API_KEY. Elle n'a besoin que de l'autorisation « Lire les ventes ».

const SEATIKS = {
  url: 'https://api.seatiks.com/v1',
  propriete: 'SEATIKS_API_KEY',
  joursRecherche: 60,
  ongletAVerifier: 'Ventes à vérifier',
  couleurAnnulee: '#ea9999',
};

function cleSeatiks_() {
  return PropertiesService.getScriptProperties().getProperty(SEATIKS.propriete);
}

function appelSeatiks_(chemin, methode, corps) {
  const options = {
    method: methode || 'get',
    headers: { Authorization: 'Bearer ' + cleSeatiks_() },
    muteHttpExceptions: true,
  };
  if (corps) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(corps);
  }
  const reponse = UrlFetchApp.fetch(SEATIKS.url + chemin, options);
  const json = JSON.parse(reponse.getContentText() || '{}');
  if (reponse.getResponseCode() >= 300) {
    const e = json.error || {};
    throw new Error('Seatiks ' + reponse.getResponseCode() + ' ' + (e.code || '') + ' : ' + (e.message || ''));
  }
  return json;
}

/** Menu « Tester la connexion Seatiks » : vérifie la clé et ses autorisations. */
function testerSeatiks() {
  let message;
  if (!cleSeatiks_()) {
    message = 'Aucune clé : ajoutez SEATIKS_API_KEY dans Paramètres du projet → Propriétés du script.';
  } else {
    try {
      const moi = appelSeatiks_('/me');
      const scopes = moi.scopes || [];
      message = 'Connexion Seatiks OK (mode ' + (moi.mode === 'live' ? 'réel' : 'test') + ').' +
        (scopes.indexOf('sales:read') < 0 ? ' Il manque l\'autorisation « Lire les ventes » sur la clé.' : '');
    } catch (e) {
      message = 'Connexion Seatiks impossible : ' + e.message;
    }
  }
  console.log(message);
  try { SpreadsheetApp.getUi().alert(message); } catch (e) { /* lancé depuis l'éditeur */ }
}

/** Menu « Importer les ventes Seatiks ». */
function importerVentesSeatiks() {
  const verrou = LockService.getScriptLock();
  if (!verrou.tryLock(30000)) return 0;
  try {
    return importerVentesSeatiks_();
  } finally {
    verrou.releaseLock();
  }
}

function importerVentesSeatiks_() {
  if (!cleSeatiks_()) return 0;
  const feuille = obtenirFeuille_();
  const colonnes = lireEnTetes_(feuille);
  const tz = feuille.getParent().getSpreadsheetTimeZone();
  const proprietes = PropertiesService.getScriptProperties();
  const notees = proprietes.getProperties();
  let ajoutees = 0;

  ventesSeatiks_().reverse().forEach(function (v) { // plus anciennes d'abord
    const cle = 'seatiks_' + v.id;
    const deja = notees[cle] ? JSON.parse(notees[cle]) : null;
    const annulee = /^cancelled/.test(v.status);

    if (!deja) {
      if (annulee) return; // annulée avant d'avoir été notée : rien à faire
      const lignes = lireLignes_(feuille, colonnes);
      const choix = ligneParNote_(lignes, v) || trouverLigne_(lignes, v, tz);
      if (!choix.ligne) {
        aVerifier_(feuille, v, choix.raison);
        proprietes.setProperty(cle, JSON.stringify({ aVerifier: true }));
        return;
      }
      appliquerVente_(feuille, colonnes, choix.ligne, v);
      proprietes.setProperty(cle, JSON.stringify({ order: choix.orderId, paye: !!v.is_paid }));
      ajoutees++;
      return;
    }

    // Vente déjà notée : suivre le paiement et les annulations.
    if (deja.aVerifier || deja.annulee) return;
    const ligne = ligneDeCommande_(feuille, colonnes, deja.order);
    if (!ligne) return;
    if (v.is_paid && !deja.paye) {
      mettreCellule_(feuille, colonnes, ligne, 'ARGENT RECU?', 'OUI');
      deja.paye = true;
    }
    if (annulee) {
      feuille.getRange(ligne, 1, 1, feuille.getLastColumn()).setBackground(SEATIKS.couleurAnnulee);
      aVerifier_(feuille, v, 'Vente annulée sur Seatiks : ligne ' + ligne + ' surlignée en rouge, à corriger à la main.');
      deja.annulee = true;
    }
    proprietes.setProperty(cle, JSON.stringify(deja));
  });

  console.log(ajoutees + ' vente(s) Seatiks ajoutée(s).');
  return ajoutees;
}

function ventesSeatiks_() {
  const depuis = new Date(Date.now() - SEATIKS.joursRecherche * 864e5).toISOString();
  const ventes = [];
  let curseur = '';
  do {
    const page = appelSeatiks_(
      '/sales?limit=200&created_since=' + encodeURIComponent(depuis) +
      (curseur ? '&cursor=' + encodeURIComponent(curseur) : '')
    );
    ventes.push.apply(ventes, page.data || []);
    curseur = page.has_more ? page.next_cursor : '';
  } while (curseur);
  return ventes;
}

/** Les lignes du tableau, avec ce qu'il faut pour reconnaître une commande. */
function lireLignes_(feuille, colonnes) {
  const n = feuille.getLastRow();
  if (n < 2) return [];
  const plage = feuille.getRange(2, 1, n - 1, feuille.getLastColumn());
  const affiche = plage.getDisplayValues();
  const valeurs = plage.getValues();
  const bloc = titreQui_(colonnes, /BLOC/);
  return affiche.map(function (r, i) {
    const cellule = function (titre) { return titre && colonnes[titre] ? r[colonnes[titre] - 1] : ''; };
    const vendus = cellule('TICKETS VENDUS').match(/(\d+)\s*\/\s*(\d+)/);
    return {
      ligne: i + 2,
      evenement: r[0],
      date: colonnes['DATE'] ? valeurs[i][colonnes['DATE'] - 1] : '',
      places: cellule('PLACES') + ' ' + cellule(bloc),
      orderId: cellule('ORDER ID VIAGOGO').trim(),
      vendus: vendus ? Number(vendus[1]) : 0,
      total: vendus ? Number(vendus[2]) : 0,
    };
  });
}

/**
 * Le plus sûr : le n° de commande Viagogo écrit dans la note interne de la
 * vente ou de l'annonce Seatiks. Lire l'annonce demande « Consulter les annonces ».
 */
function ligneParNote_(lignes, v) {
  let notes = v.internal_note || '';
  if (v.listing_id) {
    try {
      notes += ' ' + (appelSeatiks_('/listings/' + encodeURIComponent(v.listing_id)).internal_note || '');
    } catch (e) { /* clé sans « Consulter les annonces » : on s'en passe */ }
  }
  const nombres = notes.match(/\d{6,}/g) || [];
  const l = lignes.filter(function (l) { return l.orderId && nombres.indexOf(l.orderId) >= 0; })[0];
  return l ? { ligne: l.ligne, orderId: l.orderId } : null;
}

/**
 * La ligne d'achat qui correspond à une vente : même date d'événement, au moins
 * un mot du nom en commun, assez de billets pas encore vendus. La section
 * départage. Plusieurs lignes ex aequo ou aucune : la vente est mise de côté.
 */
function trouverLigne_(lignes, v, tz) {
  const ev = v.event || {};
  const jour = ev.start_date ? jourIso_(new Date(ev.start_date), tz) : '';
  const mots = motsCles_(ev.name);
  const section = motsCles_(v.section).filter(function (m) { return /\d/.test(m); });
  let meilleur = 0;
  let candidates = [];
  lignes.forEach(function (l) {
    if (!l.orderId || !l.total || l.total - l.vendus < (v.quantity || 1)) return;
    if (jour && jourIso_(l.date, tz) !== jour) return;
    const communs = motsCles_(l.evenement).filter(function (m) { return mots.indexOf(m) >= 0; }).length;
    if (!communs) return;
    const places = motsCles_(l.places);
    const score = communs + (section.some(function (m) { return places.indexOf(m) >= 0; }) ? 10 : 0);
    if (score > meilleur) {
      meilleur = score;
      candidates = [l];
    } else if (score === meilleur) {
      candidates.push(l);
    }
  });
  if (candidates.length === 1) return { ligne: candidates[0].ligne, orderId: candidates[0].orderId };
  return {
    raison: candidates.length
      ? 'Plusieurs commandes possibles (lignes ' + candidates.map(function (l) { return l.ligne; }).join(', ') + ')'
      : 'Aucune commande trouvée avec la même date, le même événement et des billets disponibles',
  };
}

function appliquerVente_(feuille, colonnes, ligne, v) {
  const lire = function (titre) {
    return colonnes[titre] ? feuille.getRange(ligne, colonnes[titre]).getDisplayValue().trim() : '';
  };
  const m = lire('TICKETS VENDUS').match(/(\d+)\s*\/\s*(\d+)/);
  const vendus = (m ? Number(m[1]) : 0) + (v.quantity || 0);
  const total = m ? Number(m[2]) : v.quantity;
  mettreCellule_(feuille, colonnes, ligne, 'TICKETS VENDUS', vendus + '/' + total);
  if (vendus >= total) mettreCellule_(feuille, colonnes, ligne, 'VENDU ?', 'OUI');

  // PRIX VENTE = ce que Seatiks vous reverse ; additionné si la commande est vendue en plusieurs fois.
  const montant = v.payout && v.payout.total_amount;
  if (montant != null && colonnes['PRIX VENTE']) {
    const cellule = feuille.getRange(ligne, colonnes['PRIX VENTE']);
    const avant = cellule.getValue();
    cellule.setValue((typeof avant === 'number' ? avant : 0) + montant);
    const symbole = { USD: '$', GBP: '£' }[v.payout.currency];
    cellule.setNumberFormat(symbole ? '"' + symbole + '"#,##0.00' : '#,##0.00');
  }

  const ref = v.short_id || v.id;
  const avantRef = lire('ORDER ID SEATIKS/TIXSTOCK');
  mettreCellule_(feuille, colonnes, ligne, 'ORDER ID SEATIKS/TIXSTOCK',
    !avantRef || avantRef === '//' ? ref : avantRef + ', ' + ref);
  mettreCellule_(feuille, colonnes, ligne, 'LISTE', 'Seatiks');
  if (v.is_paid) mettreCellule_(feuille, colonnes, ligne, 'ARGENT RECU?', 'OUI');
}

function mettreCellule_(feuille, colonnes, ligne, titre, valeur) {
  if (colonnes[titre]) feuille.getRange(ligne, colonnes[titre]).setValue(valeur);
}

function ligneDeCommande_(feuille, colonnes, orderId) {
  const n = feuille.getLastRow();
  if (!orderId || n < 2) return 0;
  const ids = feuille.getRange(2, colonnes['ORDER ID VIAGOGO'], n - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0].trim() === orderId) return i + 2;
  return 0;
}

/** Note une vente à traiter à la main dans l'onglet « Ventes à vérifier ». */
function aVerifier_(feuille, v, raison) {
  const classeur = feuille.getParent();
  let onglet = classeur.getSheetByName(SEATIKS.ongletAVerifier);
  if (!onglet) {
    onglet = classeur.insertSheet(SEATIKS.ongletAVerifier);
    onglet.appendRow(['Noté le', 'Site', 'N° vente', 'Événement', 'Date', 'Section', 'Rang', 'Quantité', 'Montant', 'Raison']);
    onglet.setFrozenRows(1);
    onglet.getRange(1, 1, 1, 10).setFontWeight('bold');
  }
  const ev = v.event || {};
  onglet.appendRow([
    new Date(), 'Seatiks', v.short_id || v.id, ev.name || '', ev.start_date ? new Date(ev.start_date) : '',
    v.section || '', v.row || '', v.quantity || '',
    v.payout && v.payout.total_amount != null ? v.payout.total_amount + ' ' + (v.payout.currency || '') : '',
    raison,
  ]);
}

/** « 2026-10-17 » pour une date, ou une date affichée « 17/10/2026 ». */
function jourIso_(d, tz) {
  if (d instanceof Date && !isNaN(d)) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  const m = String(d || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : '';
}

const MOTS_VIDES_ = ['vs', 'fc', 'sv', 'the', 'and', 'les', 'des', 'club', 'stadium', 'stade', 'tour'];

/** Mots en minuscules sans accents : « 1. FC Köln » → ['koln']. */
function motsCles_(texte) {
  return String(texte || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(function (m) { return (m.length >= 3 || /\d/.test(m)) && MOTS_VIDES_.indexOf(m) < 0; });
}

// --- Annonces Seatiks ---------------------------------------------------------
//
// Un prix écrit dans la colonne PRIX LISTING (prix par billet, en euros) crée
// l'annonce sur Seatiks : E-ticket, billets vendus tous ensemble, toutes les
// plateformes, n° de commande Viagogo en note interne. Changer le prix met
// l'annonce à jour ; vider la case la retire de la vente. Le résultat s'affiche
// en note sur la case (survolez-la). La clé doit avoir « Lire les événements »
// et « Créer, mettre à jour et supprimer des annonces ».

const ANNONCE = {
  transfer_method: 'E-ticket',
  split_type: 'All together',
  price_currency: 'EUR',
  // Pas de « platforms » : l'annonce est publiée sur toutes les plateformes.
};

/** Déclencheur « à la modification » installé par installerDeclencheur. */
function surModification(e) {
  const feuille = e.range.getSheet();
  if (feuille.getSheetId() !== obtenirFeuille_().getSheetId()) return;
  const colonnes = lireEnTetes_(feuille);
  const col = colonnes['PRIX LISTING'];
  if (!col || e.range.getColumn() > col || e.range.getLastColumn() < col) return;
  const verrou = LockService.getScriptLock();
  if (!verrou.tryLock(30000)) return;
  try {
    for (let ligne = Math.max(2, e.range.getRow()); ligne <= e.range.getLastRow(); ligne++) {
      const cellule = feuille.getRange(ligne, col);
      try {
        cellule.setNote(gererAnnonce_(feuille, colonnes, ligne));
      } catch (err) {
        cellule.setNote('Erreur : ' + err.message);
      }
    }
  } finally {
    verrou.releaseLock();
  }
}

/** Crée, met à jour ou retire l'annonce de la ligne. Renvoie le texte de la note. */
function gererAnnonce_(feuille, colonnes, ligne) {
  if (!cleSeatiks_()) return 'Pas de clé Seatiks : ajoutez SEATIKS_API_KEY dans les propriétés du script.';
  const r = lireLignes_(feuille, colonnes).filter(function (l) { return l.ligne === ligne; })[0];
  if (!r || !r.orderId) return 'Pas de n° de commande Viagogo sur cette ligne : rien n\'est listé.';

  const valeur = feuille.getRange(ligne, colonnes['PRIX LISTING']).getValue();
  const proprietes = PropertiesService.getScriptProperties();
  const cle = 'annonce_' + r.orderId;
  const annonce = JSON.parse(proprietes.getProperty(cle) || 'null');

  // Case vidée : l'annonce est retirée de la vente.
  if (valeur === '' || valeur === null) {
    if (!annonce || !annonce.publiee) return '';
    appelSeatiks_('/listings/' + annonce.id + '/unpublish', 'post');
    annonce.publiee = false;
    proprietes.setProperty(cle, JSON.stringify(annonce));
    return 'Annonce retirée de la vente sur Seatiks. Remettez un prix pour la republier.';
  }

  const prix = typeof valeur === 'number' ? valeur : enNombre_(String(valeur));
  if (!(prix > 0)) return 'Prix illisible : écrivez un nombre, par exemple 250.';

  // Annonce déjà créée : nouveau prix, et republication si elle avait été retirée.
  if (annonce) {
    appelSeatiks_('/listings/' + annonce.id, 'patch', { price: prix });
    if (!annonce.publiee) {
      appelSeatiks_('/listings/' + annonce.id + '/publish', 'post');
      annonce.publiee = true;
      proprietes.setProperty(cle, JSON.stringify(annonce));
    }
    return 'Annonce Seatiks à jour : ' + prix + ' € par billet.';
  }

  // Nouvelle annonce.
  const restants = r.total - r.vendus;
  if (!(restants > 0)) return 'Plus aucun billet à vendre sur cette ligne (TICKETS VENDUS).';
  const tz = feuille.getParent().getSpreadsheetTimeZone();
  const ev = evenementSeatiks_(r, tz);
  const places = decouperPlaces_(feuille, colonnes, ligne);
  const forcee = titreQui_(colonnes, /^SECTION SEATIKS$/);
  const section = sectionSeatiks_(ev.id, (forcee && feuille.getRange(ligne, colonnes[forcee]).getDisplayValue().trim()) || places.bloc);

  const item = Object.assign({
    event_id: ev.id,
    section: section.key,
    quantity: restants,
    price: prix,
    internal_note: 'Viagogo ' + r.orderId,
    idempotency_key: 'vgg-' + r.orderId,
  }, ANNONCE);
  const rang = places.rang.replace(/[^A-Za-z0-9/-]/g, '').slice(0, 20);
  if (rang) {
    item.row = rang;
    const siege = (places.sieges.match(/[A-Za-z0-9]+/) || [''])[0].slice(0, 10);
    if (siege) item.first_seat = siege;
  } else {
    item.hide_seats = true;
  }

  const resultat = (appelSeatiks_('/listings', 'post', { listings: [item] }).data || [])[0] || {};
  const id = resultat.id || (resultat.listing && resultat.listing.id);
  if (['created', 'duplicate', 'pending_approval'].indexOf(resultat.status) >= 0) {
    if (id) proprietes.setProperty(cle, JSON.stringify({ id: id, publiee: true }));
    mettreCellule_(feuille, colonnes, ligne, 'LISTE', 'Seatiks');
    if (resultat.status === 'pending_approval') {
      return 'Annonce envoyée : Seatiks doit la valider. Remettez le même prix plus tard pour voir où elle en est.';
    }
    return 'Annonce créée sur Seatiks : ' + ev.name + ', section ' + section.name + ', ' +
      restants + ' billet(s) à ' + prix + ' € (E-ticket, tous ensemble, toutes les plateformes).';
  }
  const err = resultat.error || {};
  if (err.code === 'rejected') {
    return 'Seatiks a refusé l\'annonce : ' + (err.message || '') +
      ' Tant que le compte a moins de 5 ventes, il faut lister depuis le site Seatiks, avec la preuve d\'achat.';
  }
  return 'Seatiks a refusé l\'annonce : ' + (err.code || resultat.status || '') + ' ' + (err.message || '');
}

/** { bloc, rang, sieges } depuis les colonnes BLOC / RANG, sinon depuis PLACES. */
function decouperPlaces_(feuille, colonnes, ligne) {
  const lire = function (titre) {
    return titre && colonnes[titre] ? feuille.getRange(ligne, colonnes[titre]).getDisplayValue().trim() : '';
  };
  const morceaux = lire('PLACES').replace(/^x\d+\s+/i, '').split(/\s+\/\s+/);
  return {
    bloc: lire(titreQui_(colonnes, /^BLOC$/)) || morceaux[0] || '',
    rang: lire(titreQui_(colonnes, /^RANG(ÉE|EE)?$/)) || morceaux[1] || '',
    sieges: morceaux[2] || '',
  };
}

/** L'événement Seatiks du même jour qui a le plus de mots en commun avec le nom. */
function evenementSeatiks_(r, tz) {
  const jour = jourIso_(r.date, tz);
  if (!jour) throw new Error('Date de l\'événement manquante ou illisible (colonne DATE).');
  const debut = new Date(new Date(jour + 'T00:00:00Z').getTime() - 864e5).toISOString();
  const fin = new Date(new Date(jour + 'T00:00:00Z').getTime() + 2 * 864e5).toISOString();
  const mots = motsCles_(r.evenement);

  let meilleur = 0;
  let candidats = [];
  let curseur = '';
  let pages = 0;
  do {
    const page = appelSeatiks_('/events?listable=true&limit=100&date_from=' + encodeURIComponent(debut) +
      '&date_to=' + encodeURIComponent(fin) + (curseur ? '&cursor=' + encodeURIComponent(curseur) : ''));
    (page.data || []).forEach(function (ev) {
      if (jourIso_(new Date(ev.start_date), ev.timezone || tz) !== jour) return;
      const score = motsCles_(ev.name).filter(function (m) { return mots.indexOf(m) >= 0; }).length;
      if (!score) return;
      if (score > meilleur) {
        meilleur = score;
        candidats = [ev];
      } else if (score === meilleur) {
        candidats.push(ev);
      }
    });
    curseur = page.has_more ? page.next_cursor : '';
  } while (curseur && ++pages < 10);

  if (candidats.length === 1) return candidats[0];
  if (!candidats.length) throw new Error('Événement introuvable sur Seatiks le ' + jour.split('-').reverse().join('/') + ' : « ' + r.evenement + ' ».');
  throw new Error('Plusieurs événements possibles sur Seatiks : ' + candidats.map(function (e) { return e.name; }).join(' / ') + '.');
}

/** La section Seatiks qui correspond au bloc (« 13C » → « Block 13C »). */
function sectionSeatiks_(eventId, bloc) {
  const sections = appelSeatiks_('/events/' + encodeURIComponent(eventId)).sections || [];
  // Ici les mots courts comptent : « L GA », « A », « S4 ».
  const norm = function (t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .split(/[^a-z0-9]+/).filter(Boolean).map(synonyme_)
      .filter(function (m) { return MOTS_SECTION_.indexOf(m) < 0; });
  };
  const cherche = norm(bloc);
  if (!cherche.length) throw new Error('Bloc vide : remplissez PLACES ou BLOC, ou la colonne SECTION SEATIKS.');

  const exacte = sections.filter(function (sct) {
    return sct.key === bloc || norm(sct.name).join(' ') === cherche.join(' ');
  });
  if (exacte.length === 1) return exacte[0];

  const avecChiffres = cherche.filter(function (m) { return /\d/.test(m); });
  const requis = avecChiffres.length ? avecChiffres : cherche;
  const proches = sections.filter(function (sct) {
    const mots = norm(sct.name + ' ' + (sct.category || ''));
    return requis.every(function (m) { return mots.indexOf(m) >= 0; });
  });
  if (proches.length === 1) return proches[0];

  const exemples = (proches.length ? proches : sections).slice(0, 8).map(function (sct) { return sct.name; }).join(', ');
  throw new Error(
    (proches.length ? 'Plusieurs sections Seatiks possibles pour « ' : 'Section introuvable sur Seatiks pour « ') + bloc + ' ». ' +
    'Exemples : ' + exemples + '. Écrivez le nom exact dans une colonne SECTION SEATIKS, puis remettez le prix.'
  );
}

const MOTS_SECTION_ = ['bloc', 'block', 'section', 'secteur', 'tribune', 'zone', 'sec', 'sect'];

function synonyme_(m) {
  return { categorie: 'category', cat: 'category', fosse: 'pit', pelouse: 'floor' }[m] || m;
}
