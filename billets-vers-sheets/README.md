# Billets Viagogo / StubHub → Google Sheets

Un script Google Apps Script qui lit vos emails de confirmation Viagogo et StubHub dans Gmail et les ajoute automatiquement dans un Google Sheet, une ligne par email.

Colonnes remplies : reçu le, plateforme, objet, n° de commande, événement, date de l'événement, lieu, quantité, section, rang, places, total, email destinataire, expéditeur, lien vers l'email dans Gmail, ID du message.

## Installation (5 minutes)

1. Ouvrez (ou créez) votre Google Sheet.
2. Menu **Extensions → Apps Script**.
3. Supprimez le contenu de `Code.gs`, collez celui de [`Code.gs`](./Code.gs), puis cliquez sur **Enregistrer**.
4. Dans la liste des fonctions en haut, choisissez `installerDeclencheur`, puis cliquez sur **Exécuter**.
5. Google demande des autorisations (lire Gmail, modifier le Sheet). Acceptez-les. Si l'écran « Google n'a pas validé cette application » apparaît : **Paramètres avancés → Accéder au projet**. C'est votre propre script, il tourne sur votre compte.

C'est tout. Le script :
- importe tout de suite les emails des 2 dernières années ;
- relance l'import toutes les 15 minutes ;
- crée une feuille **Billets** si elle n'existe pas ;
- ajoute le libellé Gmail **Billets importés** aux emails traités ;
- n'importe jamais deux fois le même email.

Au prochain rechargement du Sheet, un menu **Billets** apparaît, avec les entrées « Importer maintenant », « Activer » et « Désactiver l'import automatique ».

## Réglages

En haut de `Code.gs`, l'objet `CONFIG` contient :
- `recherche` : la recherche Gmail utilisée. Elle prend les emails dont l'expéditeur contient « viagogo » ou « stubhub » et dont l'objet parle de commande, de billets ou de confirmation. Les newsletters sont donc ignorées. Vous pouvez tester la requête dans la barre de recherche de Gmail.
- `nomFeuille`, `libelleGmail`, `intervalleMinutes`.

## Limites

Les emails Viagogo et StubHub ne suivent pas tous le même format. Les champs détaillés (événement, section, rang, places, total…) sont donc lus « au mieux », à partir de libellés comme `Section :` ou `Total`. Quand un champ n'est pas trouvé, la cellule reste vide, mais l'objet de l'email et le lien Gmail sont toujours remplis. Si une colonne reste vide de façon régulière, envoyez un exemple d'email (en masquant vos données personnelles) pour qu'on adapte la lecture.
