/**
 * Revente Billets : envoie vos emails d'achat Gmail au site.
 *
 * Toutes les 5 minutes, ce script cherche les nouveaux emails Ticketmaster, Viagogo
 * et StubHub (tous pays), les envoie au site qui les lit, puis demande au
 * site de récupérer les ventes Seatiks.
 *
 * Réglages (Paramètres du projet → Propriétés du script) :
 *   SITE_URL    l'adresse du site, ex. https://revente-billets.vercel.app
 *   CLE_SCRIPT  la même valeur que CLE_SCRIPT dans Vercel
 */

const LIBELLE = 'Envoyé au site';
// Pour un nouveau site d'achat, ajoutez son nom ici (ex. « OR axs OR seetickets »).
const EXPEDITEURS = 'ticketmaster OR viagogo OR stubhub';

function reglage_(nom) {
  const v = (PropertiesService.getScriptProperties().getProperty(nom) || '').trim();
  if (!v) throw new Error('Ajoutez ' + nom + ' dans Paramètres du projet → Propriétés du script.');
  return v.replace(/\/+$/, '');
}

/** Lancé toutes les 5 minutes par le déclencheur. */
function envoyerAuSite() {
  const url = reglage_('SITE_URL');
  const cle = reglage_('CLE_SCRIPT');
  const proprietes = PropertiesService.getScriptProperties();
  // On repart de zéro : seuls les emails reçus depuis l'installation sont envoyés.
  let depuis = proprietes.getProperty('DEPUIS');
  if (!depuis) {
    depuis = Utilities.formatDate(new Date(), 'Etc/UTC', 'yyyy/MM/dd');
    proprietes.setProperty('DEPUIS', depuis);
  }
  const libelle = GmailApp.getUserLabelByName(LIBELLE) || GmailApp.createLabel(LIBELLE);
  const fils = GmailApp.search('from:(' + EXPEDITEURS + ') -label:"' + LIBELLE + '" after:' + depuis, 0, 30);

  let envoyes = 0;
  for (const fil of fils) {
    let toutOk = true;
    for (const m of fil.getMessages()) {
      const r = UrlFetchApp.fetch(url + '/api/emails', {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-cle-site': cle },
        payload: JSON.stringify({
          message_id: m.getId(), de: m.getFrom(), a: m.getTo(), objet: m.getSubject(),
          date: m.getDate().toISOString(), corps: m.getPlainBody(),
        }),
        muteHttpExceptions: true,
      });
      const code = r.getResponseCode();
      if (code === 401) throw new Error('Le site refuse la clé : vérifiez que CLE_SCRIPT est identique ici et dans Vercel.');
      if (code >= 300) { toutOk = false; console.warn('Email non traité (' + code + '), réessai au prochain passage : ' + r.getContentText()); }
      else envoyes++;
    }
    if (toutOk) fil.addLabel(libelle);
  }
  console.log(envoyes + ' email(s) envoyé(s) au site.');

  // Ventes Seatiks
  const s = UrlFetchApp.fetch(url + '/api/sync', { method: 'post', headers: { 'x-cle-site': cle }, muteHttpExceptions: true });
  console.log('Ventes Seatiks : ' + s.getContentText());
}

/** À lancer une fois : installe le passage toutes les 5 minutes et fait un premier envoi. */
function installer() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'envoyerAuSite'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('envoyerAuSite').timeBased().everyMinutes(5).create();
  envoyerAuSite();
}
