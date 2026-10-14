import Anthropic from '@anthropic-ai/sdk';

let client;
const ia = () => (client ??= new Anthropic()); // lit ANTHROPIC_API_KEY

const texte = (description) => ({ type: ['string', 'null'], description });

// Ce que l'IA doit renvoyer pour chaque email : du JSON qui suit exactement ce schéma.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['est_achat', 'site', 'numero_commande', 'evenement', 'lieu', 'date_evenement', 'bloc', 'rang', 'sieges',
    'quantite', 'prix_total', 'devise', 'nom_client', 'paiement', 'annulation_probable'],
  properties: {
    est_achat: { type: 'boolean', description: "true seulement si l'email confirme un achat de billets que le destinataire vient de payer." },
    site: { type: 'string', description: 'Plateforme où les billets ont été achetés, sans le pays : Ticketmaster, Viagogo, StubHub…' },
    numero_commande: texte('Numéro de commande exact, tel qu\'écrit dans l\'email.'),
    evenement: texte("Nom de l'événement (match, concert, spectacle), tel qu'écrit dans l'email."),
    lieu: texte('Salle ou stade.'),
    date_evenement: texte("Date de l'événement au format AAAA-MM-JJ."),
    bloc: texte('Bloc, section, tribune ou catégorie.'),
    rang: texte('Rang (row).'),
    sieges: texte('Sièges : un numéro, ou une plage « 35-36 » quand ils se suivent.'),
    quantite: { type: ['integer', 'null'], description: 'Nombre de billets.' },
    prix_total: { type: ['number', 'null'], description: 'Montant total payé, frais compris.' },
    devise: texte('Code ISO de la devise du total : EUR, USD, GBP…'),
    nom_client: texte("Nom de l'acheteur ou du titulaire, s'il apparaît."),
    paiement: texte('4 derniers chiffres de la carte, ou « Apple Pay », « PayPal »…'),
    annulation_probable: { type: 'boolean', description: "true si l'email annonce un contrôle ou un « further email » avant de confirmer la commande, signe qu'elle risque d'être annulée." },
  },
};

const CONSIGNES = `Tu lis des emails reçus par un revendeur de billets et tu en extrais les informations d'achat.
Recopie les valeurs telles qu'elles sont écrites dans l'email, sans les deviner : mets null quand une information n'y figure pas.
Les emails peuvent venir de n'importe quel pays et être dans n'importe quelle langue.
Un email qui n'est pas une confirmation d'achat (publicité, billets prêts à télécharger, rappel d'événement, vente de billets) a est_achat = false.`;

/**
 * Extrait les informations d'achat d'un email.
 * Renvoie l'objet décrit par SCHEMA, ou lève une erreur si l'IA refuse ou ne répond pas.
 */
export async function lireEmail({ de, a, objet, date, corps }) {
  const reponse = await ia().beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    // Si l'IA refuse par erreur, la requête est relancée sur le modèle de repli recommandé.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: CONSIGNES,
    messages: [{ role: 'user', content: `De : ${de}\nÀ : ${a}\nObjet : ${objet}\nDate : ${date}\n\n${corps}` }],
  });
  if (reponse.stop_reason === 'refusal') throw new Error('L\'IA a refusé de lire cet email.');
  if (reponse.stop_reason === 'max_tokens') throw new Error('Réponse de l\'IA tronquée.');
  const bloc = reponse.content.find(b => b.type === 'text');
  if (!bloc) throw new Error('Réponse de l\'IA vide.');
  return JSON.parse(bloc.text);
}
