# Revente Billets : le site

Le site suit vos achats de billets (Ticketmaster de tous pays, Viagogo, StubHub), les met en vente sur Seatiks, et calcule vos bénéfices.

## Comment ça marche

1. Vous achetez un billet : l'email de confirmation arrive dans votre Gmail, comme aujourd'hui (réexpédition iCloud).
2. Toutes les 5 minutes, le petit script Gmail (`apps-script/Code.gs`) envoie les nouveaux emails au site.
3. Le site lit chaque email (gratuitement, ou avec l'IA si vous ajoutez une clé Anthropic) et crée la commande. Ce qui manque (rang, sièges…) est marqué « à compléter ».
4. Sur la fiche du billet, vous mettez un prix : l'annonce part sur Seatiks (E-ticket, tous ensemble, toutes les plateformes).
5. Les ventes Seatiks reviennent toutes seules : vendu, montant reçu, payé, livré.

## Installation

### 1. Supabase (base de données, gratuit)
1. Créez un compte sur supabase.com, puis **New project**. Notez le mot de passe de la base quelque part, il ne servira pas au site.
2. Menu **SQL Editor** → **New query** → collez tout le fichier `supabase/schema.sql` → **Run**.
3. Menu **Project Settings → API** : notez **Project URL** et la clé **service_role** (pas la clé anon).

### 2. Clé IA (facultatif)
Sans clé, les emails sont lus gratuitement en cherchant les libellés habituels (Order number, Section, Row, Total…). L'IA lit mieux les formats inhabituels. Pour l'activer :
1. Créez un compte sur console.anthropic.com, ajoutez un crédit (5 € pour commencer).
2. **API Keys → Create Key**, notez la clé.

### 3. Vercel (mise en ligne, gratuit)
1. Créez un compte sur vercel.com avec votre compte GitHub.
2. **Add New → Project**, importez le dépôt `claude`.
3. **Root Directory** : `site`. Laissez le reste par défaut.
4. **Environment Variables**, ajoutez :

| Nom | Valeur |
|---|---|
| `SUPABASE_URL` | le Project URL de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | la clé service_role de Supabase |
| `ANTHROPIC_API_KEY` | facultatif : la clé IA |
| `SEATIKS_API_KEY` | votre clé Seatiks `stk_live_…` |
| `SITE_PASSWORD` | le mot de passe pour entrer sur le site (choisissez-le) |
| `CLE_SCRIPT` | une longue phrase secrète inventée, ex. 40 lettres et chiffres au hasard |

5. **Deploy**. Vercel vous donne l'adresse du site, du type `https://revente-billets.vercel.app`.

### 4. Script Gmail
1. Sur script.google.com, connecté à ticketsa6118@gmail.com : **Nouveau projet**.
2. Collez `apps-script/Code.gs`, enregistrez.
3. **Paramètres du projet → Propriétés du script** : ajoutez `SITE_URL` (l'adresse Vercel) et `CLE_SCRIPT` (la même valeur que dans Vercel).
4. Exécutez `installer`, acceptez les autorisations.
5. Dans l'ancien projet lié au Google Sheet, exécutez `supprimerDeclencheur` pour l'arrêter.

## Bon à savoir
- Lecture d'un email : gratuite sans clé IA ; avec l'IA, environ 1 à 3 centimes selon la longueur.
- Les commandes passées avant l'installation ne sont pas importées : on repart de zéro.
- Pour un nouveau site d'achat, ajoutez son nom dans `EXPEDITEURS`, en haut du script Gmail.
- Une vente Seatiks d'une annonce créée hors du site arrive dans « À faire → Ventes Seatiks à rattacher ».
