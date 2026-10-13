/**
 * Billets → Google Sheets
 *
 * Lit les emails de confirmation Viagogo et StubHub dans Gmail et ajoute
 * une ligne par email dans la feuille « Billets » du Google Sheet auquel
 * ce script est rattaché. Un déclencheur relance l'import toutes les
 * 15 minutes. Chaque email n'est importé qu'une fois (colonne « ID message »).
 */

const CONFIG = {
  nomFeuille: 'Billets',
  libelleGmail: 'Billets importés',
  intervalleMinutes: 15,
  // Emails des deux plateformes qui parlent d'une commande (pas les newsletters).
  recherche:
    'from:(viagogo OR stubhub) ' +
    'subject:(commande OR order OR confirmation OR confirmé OR confirmed OR billet OR billets OR ticket OR tickets OR achat OR purchase) ' +
    'newer_than:2y',
};

const COLONNES = [
  'Reçu le',
  'Plateforme',
  'Objet',
  'N° commande',
  'Événement',
  'Date événement',
  'Lieu',
  'Quantité',
  'Section',
  'Rang',
  'Places',
  'Total',
  'Email destinataire',
  'Expéditeur',
  'Lien Gmail',
  'ID message',
];

/** Menu « Billets » dans le Google Sheet. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Billets')
    .addItem('Importer maintenant', 'importerBillets')
    .addItem('Activer l\'import automatique', 'installerDeclencheur')
    .addItem('Désactiver l\'import automatique', 'supprimerDeclencheur')
    .addToUi();
}

/** Cherche les nouveaux emails et les ajoute à la feuille. */
function importerBillets() {
  const feuille = obtenirFeuille_();
  const dejaImportes = idsDejaImportes_(feuille);
  const libelle =
    GmailApp.getUserLabelByName(CONFIG.libelleGmail) ||
    GmailApp.createLabel(CONFIG.libelleGmail);

  const lignes = [];
  let debut = 0;
  let fils;
  do {
    fils = GmailApp.search(CONFIG.recherche, debut, 100);
    fils.forEach(function (fil) {
      fil.getMessages().forEach(function (message) {
        const id = message.getId();
        if (dejaImportes.has(id)) return;
        lignes.push(analyserMessage_(message));
        dejaImportes.add(id);
      });
      fil.addLabel(libelle);
    });
    debut += fils.length;
  } while (fils.length === 100);

  if (lignes.length) {
    // Du plus ancien au plus récent.
    lignes.sort(function (a, b) { return a[0] - b[0]; });
    feuille
      .getRange(feuille.getLastRow() + 1, 1, lignes.length, COLONNES.length)
      .setValues(lignes);
  }
  console.log(lignes.length + ' email(s) importé(s).');
  return lignes.length;
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

// --- Analyse d'un email -----------------------------------------------------

function analyserMessage_(message) {
  const objet = message.getSubject() || '';
  const expediteur = message.getFrom() || '';
  const corps = (message.getPlainBody() || '').replace(/ /g, ' ');
  const lignes = corps
    // Les champs alignés sur une même ligne (« Section: 512   Row: 3 ») sont séparés.
    .split(/\r?\n|\t| {2,}/)
    .map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
    .filter(Boolean);
  const texte = lignes.join('\n');

  const plateforme = /stubhub/i.test(expediteur) ? 'StubHub'
    : /viagogo/i.test(expediteur) ? 'Viagogo'
    : '';

  return [
    message.getDate(),
    plateforme,
    objet,
    numeroCommande_(objet + '\n' + texte),
    evenement_(objet, lignes),
    dateEvenement_(texte),
    valeurApres_(lignes, /^(lieu|salle|stade|venue|location)\b/i),
    quantite_(texte),
    valeurApres_(lignes, /^(section|secteur|bloc|catégorie|category|zone)\b/i),
    valeurApres_(lignes, /^(rang(ée)?|row)\b/i),
    valeurApres_(lignes, /^(si[eè]ges?|places?|seats?)\b/i),
    total_(lignes),
    message.getTo() || '',
    expediteur,
    'https://mail.google.com/mail/u/0/#all/' + message.getThread().getId(),
    message.getId(),
  ];
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
    /(?:n[°o]\.?\s*(?:de\s*)?commande|commande\s*(?:n[°o]\.?)?|order\s*(?:number|no\.?|id)?|r[ée]f[ée]rence)\s*[:#]?\s*#?\s*([A-Z0-9][A-Z0-9-]{4,})/i
  );
  return m ? m[1] : '';
}

function evenement_(objet, lignes) {
  const champ = valeurApres_(lignes, /^(événement|évènement|event)\b/i);
  if (champ) return champ;
  // Ex. « Votre commande pour Coldplay est confirmée », « Your order for X is confirmed »
  const m = objet.match(/\b(?:pour|for)\s+(.+?)(?:\s+(?:est|is|a été|has been)\b|\s*[-–|]|$)/i);
  return m ? m[1].trim() : '';
}

const MOIS_ =
  '(?:janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec|' +
  'jan|feb|mar|apr|may|jun|jul|aug|sep)[a-zéû]*\\.?';

function dateEvenement_(texte) {
  const heure = '(?:\\s*(?:à|at|,|-|–)?\\s*\\d{1,2}[:h]\\d{2}(?:\\s*[ap]m)?)?';
  const formats = [
    new RegExp('\\b\\d{1,2}\\s+' + MOIS_ + '\\s+\\d{4}' + heure, 'i'),     // 14 juin 2026
    new RegExp('\\b' + MOIS_ + '\\s+\\d{1,2},?\\s+\\d{4}' + heure, 'i'),   // June 14, 2026
    new RegExp('\\b\\d{1,2}/\\d{1,2}/\\d{4}' + heure),                    // 14/06/2026
  ];
  for (const f of formats) {
    const m = texte.match(f);
    if (m) return m[0].trim();
  }
  return '';
}

function quantite_(texte) {
  const m =
    texte.match(/(?:quantit[ée]|quantity|qt[ée]|nombre de billets)\s*:?\s*(\d+)/i) ||
    texte.match(/\b(\d+)\s*(?:x\s*)?(?:billets?|tickets?|e-?tickets?)\b/i);
  return m ? Number(m[1]) : '';
}

function total_(lignes) {
  const montant = /(?:[€$£]\s?\d[\d\s.,]*\d|\d[\d\s.,]*\d?\s?(?:€|EUR|USD|GBP|\$|£))/i;
  for (let i = 0; i < lignes.length; i++) {
    if (!/\b(total|montant|amount|payé|paid)\b/i.test(lignes[i])) continue;
    const m = lignes[i].match(montant) || (lignes[i + 1] || '').match(montant);
    if (m) return m[0].trim();
  }
  return '';
}

// --- Feuille ----------------------------------------------------------------

function obtenirFeuille_() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  let feuille = classeur.getSheetByName(CONFIG.nomFeuille);
  if (!feuille) feuille = classeur.insertSheet(CONFIG.nomFeuille);
  if (feuille.getLastRow() === 0) {
    feuille.appendRow(COLONNES);
    feuille.setFrozenRows(1);
    feuille.getRange(1, 1, 1, COLONNES.length).setFontWeight('bold');
    feuille.getRange('A:A').setNumberFormat('dd/mm/yyyy hh:mm');
  }
  return feuille;
}

function idsDejaImportes_(feuille) {
  const derniere = feuille.getLastRow();
  if (derniere < 2) return new Set();
  const col = COLONNES.indexOf('ID message') + 1;
  return new Set(
    feuille.getRange(2, col, derniere - 1, 1).getValues().map(function (r) { return String(r[0]); })
  );
}
