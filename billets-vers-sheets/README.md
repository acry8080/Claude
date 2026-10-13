# Billets Viagogo / StubHub → Google Sheets

Un script Google Apps Script qui lit vos emails de confirmation de commande Viagogo et StubHub dans Gmail et ajoute chaque commande dans votre tableau de suivi existant, au même format que vos lignes saisies à la main.

## Ce qui est rempli automatiquement

| Colonne | Valeur |
|---|---|
| A (match) | Nom de l'événement |
| VENDU ? | `NON` |
| PRIX ACHAT | Total payé, en nombre (ex. `1007.02`) |
| PRIX VENTE | `//` |
| TICKETS VENDUS | `0/` + nombre de billets (ex. `0/2`) |
| DATE | Date de l'événement |
| ORDER ID SEATIKS/TIXSTOCK | `//` |
| ORDER ID VIAGOGO | Numéro de commande |
| COMMANDE VGG? | `OUI` |
| REMBOURSE ? | `NON` |
| PLACES | `section / rang / sièges` (ex. `B1 / 25 / 5-6`), ou `x4 GA` quand il n'y a pas de rang |
| MAIL | Adresse qui a reçu l'email (votre adresse iCloud) |
| INFORMATIONS | Nom trouvé dans l'email |
| ARGENT RECU? | `NON` |
| NUM CC | 4 derniers chiffres de la carte |
| VIAGOGO SEND TICKET | `INSTANT` si l'email parle de livraison instantanée |

Les colonnes jaune, LISTE et RF LANCE restent vides, comme pour une commande qui vient d'être passée. Chaque nouvelle ligne reprend la mise en forme et les menus déroulants de la ligne du dessus.

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
