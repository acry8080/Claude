# Billets Viagogo / StubHub → Google Sheets

Un script Google Apps Script qui lit vos emails de confirmation de commande Viagogo et StubHub dans Gmail et ajoute chaque commande dans votre tableau de suivi existant, au même format que vos lignes saisies à la main.

## Ce qui est rempli automatiquement

| Colonne | Valeur |
|---|---|
| A (match) | Nom de l'événement |
| VENDU ? | `NON` |
| PRIX ACHAT | Total payé, en nombre (ex. `1007.02`), affiché en `$` pour les commandes en dollars |
| PRIX VENTE | `//` |
| TICKETS VENDUS | `0/` + nombre de billets (ex. `0/2`) |
| DATE | Date de l'événement |
| ORDER ID SEATIKS/TIXSTOCK | `//` |
| ORDER ID VIAGOGO | Numéro de commande |
| COMMANDE VGG? | `OUI` |
| REMBOURSE ? | `NON` |
| PLACES | `section / rang / sièges` (ex. `B1 / 25 / 5-6`), ou `x4 GA` quand il n'y a pas de rang |
| BLOC / RANG (facultatives) | Le bloc et le rang, dans des colonnes « BLOC » et « RANG » ou dans une seule colonne « BLOC ET RANG » |
| MAIL | Adresse qui a reçu l'email (votre adresse iCloud) |
| INFORMATIONS | Nom trouvé dans l'email |
| ARGENT RECU? | `NON` |
| NUM CC | 4 derniers chiffres de la carte, ou `Apple Pay` (`Google Pay`, `PayPal`) |
| VIAGOGO SEND TICKET | `INSTANT` quand l'email dit que les billets sont en préparation et renvoie au compte (« StubHub account », « Mon compte »). Vide quand il annonce « a further email » (commande probablement annulée) |
| RF LANCE | `NON` |

La colonne jaune et LISTE restent vides, comme pour une commande qui vient d'être passée. Une commande probablement annulée (email StubHub « You will receive a further email… ») est surlignée en orange. Chaque nouvelle ligne reprend la mise en forme et les menus déroulants de la ligne du dessus.

Les colonnes sont retrouvées par leur titre en ligne 1. Vous pouvez donc les déplacer, mais ne les renommez pas.

Une commande dont l'ORDER ID VIAGOGO est déjà dans le tableau n'est jamais ajoutée une deuxième fois.

## Installation (5 minutes)

1. Ouvrez votre Google Sheet.
2. Menu **Extensions → Apps Script**.
3. Supprimez le contenu de `Code.gs`, collez celui de [`Code.gs`](./Code.gs), puis cliquez sur **Enregistrer**.
4. Si votre tableau n'est pas le premier onglet du classeur, écrivez son nom dans `nomFeuille`, en haut du script.
5. Choisissez la fonction `installerDeclencheur` dans la liste en haut, puis cliquez sur **Exécuter**.
6. Acceptez les autorisations demandées (lire Gmail, modifier le Sheet). Si l'écran « Google n'a pas validé cette application » apparaît : **Paramètres avancés → Accéder au projet**.

Le script importe tout de suite les commandes de la dernière année, puis vérifie les nouveaux emails toutes les 15 minutes. Les emails traités reçoivent le libellé Gmail **Billets importés**. Au prochain rechargement du Sheet, un menu **Billets** apparaît.

## À savoir

- **Les emails doivent arriver dans le Gmail du compte Google qui possède le Sheet.** Vos adresses « Masquer mon adresse e-mail » d'iCloud transfèrent les emails vers l'adresse choisie dans votre identifiant Apple. Si c'est votre Gmail, tout fonctionne. Si c'est une boîte iCloud, changez l'adresse de transfert (Réglages → [votre nom] → iCloud → Masquer mon adresse e-mail → Transférer à).
- Les emails Viagogo et StubHub ne suivent pas tous le même format. Les champs sont donc lus « au mieux ». Une commande sans numéro de commande détectable n'est pas ajoutée. Si un champ reste vide de façon régulière, envoyez un exemple d'email (en masquant vos données personnelles) pour qu'on adapte la lecture.

## Ventes Seatiks (facultatif)

Toutes les 15 minutes, en même temps que l'import des achats, le script lit vos ventes Seatiks des 60 derniers jours grâce à l'API Seatiks, puis met à jour la ligne de la commande d'achat correspondante :

| Colonne | Valeur |
|---|---|
| TICKETS VENDUS | `2/2`, ou `2/4` pour une vente partielle |
| VENDU ? | `OUI` quand tous les billets de la ligne sont vendus |
| PRIX VENTE | Le montant que Seatiks vous reverse (additionné si la commande est vendue en plusieurs fois) |
| ORDER ID SEATIKS/TIXSTOCK | Le n° de la vente Seatiks |
| LISTE | `Seatiks` |
| ARGENT RECU? | `OUI` dès que Seatiks indique que la vente est payée |

**Retrouver la bonne ligne.** Si vous écrivez le n° de commande Viagogo dans la **note interne** de l'annonce Seatiks, la correspondance est sûre à 100 %. Sinon, le script cherche une commande avec la même date d'événement, un mot du nom en commun, assez de billets pas encore vendus, et la même section si possible. S'il trouve plusieurs lignes possibles, ou aucune, il ne devine pas : la vente est notée dans l'onglet **Ventes à vérifier**. Une vente annulée après coup surligne la ligne en rouge, et elle est aussi notée dans cet onglet.

**Installation.**
1. Sur Seatiks, allez dans **Paramètres → Développeurs** et créez une clé avec **Lire les ventes** (et **Consulter les annonces** pour utiliser la note interne).
2. Dans Apps Script, ouvrez **Paramètres du projet** (l'engrenage), puis **Propriétés du script** → **Ajouter une propriété**. Nom : `SEATIKS_API_KEY`. Valeur : votre clé. Enregistrez.
3. Rechargez le Sheet, puis cliquez sur **Billets → Tester la connexion Seatiks**.

Une clé de test (`stk_test_…`) ne voit que les ventes fictives du bac à sable Seatiks : elles iront dans **Ventes à vérifier**. Les vraies ventes arrivent avec une clé réelle (`stk_live_…`), une fois l'accès en direct accordé par Seatiks.

## Annonces Seatiks

Écrivez un prix **par billet**, en euros, dans la colonne **PRIX LISTING** : l'annonce part aussitôt sur Seatiks, avec ces réglages :
- type de billet **E-ticket** ;
- billets vendus **tous ensemble** (All together) ;
- publiée sur **toutes les plateformes** ;
- quantité = billets pas encore vendus (TICKETS VENDUS) ;
- rang et premier siège repris de PLACES, ou sièges masqués s'il n'y a pas de rang ;
- n° de commande Viagogo écrit dans la **note interne**, pour que la vente retombe toujours sur la bonne ligne.

Changer le prix met l'annonce à jour. Vider la case retire l'annonce de la vente, et remettre un prix la republie. Le résultat s'affiche en **note sur la case** : survolez-la pour le lire. LISTE passe à `Seatiks`.

Si l'événement ou la section ne sont pas trouvés sur Seatiks, rien n'est publié : la note l'explique et donne des exemples de sections. Ajoutez alors une colonne **SECTION SEATIKS**, écrivez-y le nom exact de la section Seatiks, puis remettez le prix.

Conditions côté Seatiks :
- la clé doit avoir **Lire les événements**, **Consulter les annonces**, **Créer, mettre à jour et supprimer des annonces** et **Lire les ventes** ;
- l'**accès en direct** doit être accordé ;
- le compte doit avoir **au moins 5 ventes**. Avant ça, Seatiks exige une preuve d'achat que l'API ne peut pas envoyer : il faut lister depuis le site.

Après avoir recopié le script, relancez une fois `installerDeclencheur` : c'est lui qui active la surveillance de la colonne PRIX LISTING.
