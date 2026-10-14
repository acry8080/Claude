import crypto from 'node:crypto';

// Un seul utilisateur : le mot de passe SITE_PASSWORD (variable Vercel).
// La session est un cookie signé avec ce mot de passe : le changer déconnecte tout le monde.
const DUREE_JOURS = 30;
const cle = () => 'revente-billets:' + (process.env.SITE_PASSWORD || '');
const signer = valeur => crypto.createHmac('sha256', cle()).update(valeur).digest('hex');

function egal(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function motDePasseValide(mdp) {
  return !!process.env.SITE_PASSWORD && egal(signer(String(mdp || '')), signer(process.env.SITE_PASSWORD));
}

export function ouvrirSession(res) {
  const expire = String(Date.now() + DUREE_JOURS * 864e5);
  res.setHeader('Set-Cookie', `rb_session=${expire}.${signer(expire)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DUREE_JOURS * 86400}`);
}

export function fermerSession(res) {
  res.setHeader('Set-Cookie', 'rb_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}

export function estConnecte(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)rb_session=([^;]+)/);
  if (!m || !process.env.SITE_PASSWORD) return false;
  const [expire, signature] = m[1].split('.');
  return !!expire && Number(expire) > Date.now() && egal(signature, signer(expire));
}

/** Le script Gmail s'identifie avec l'en-tête x-cle-site = CLE_SCRIPT (variable Vercel). */
export function estLeScript(req) {
  const recue = req.headers['x-cle-site'];
  return !!process.env.CLE_SCRIPT && typeof recue === 'string' && egal(recue, process.env.CLE_SCRIPT);
}

/** À appeler en tête des routes réservées : répond 401 et renvoie false si personne n'est connecté. */
export function exigerSession(req, res, { scriptAutorise = false } = {}) {
  if (!process.env.SITE_PASSWORD) {
    res.status(500).json({ erreur: 'SITE_PASSWORD manquant dans les variables Vercel.' });
    return false;
  }
  if (estConnecte(req) || (scriptAutorise && estLeScript(req))) return true;
  res.status(401).json({ erreur: 'Non connecté.' });
  return false;
}
