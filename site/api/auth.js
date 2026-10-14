import { estConnecte, fermerSession, motDePasseValide, ouvrirSession } from './_lib/auth.js';

// GET : suis-je connecté ?  POST { action: 'connexion', mot_de_passe } ou { action: 'deconnexion' }.
export default function handler(req, res) {
  if (req.method === 'GET') return res.json({ connecte: estConnecte(req), configure: !!process.env.SITE_PASSWORD });
  if (req.method !== 'POST') return res.status(405).end();
  const { action, mot_de_passe } = req.body || {};
  if (action === 'deconnexion') {
    fermerSession(res);
    return res.json({ ok: true });
  }
  if (!process.env.SITE_PASSWORD) return res.status(500).json({ erreur: 'SITE_PASSWORD manquant dans les variables Vercel.' });
  if (!motDePasseValide(mot_de_passe)) return res.status(401).json({ erreur: 'Mot de passe incorrect.' });
  ouvrirSession(res);
  res.json({ ok: true });
}
