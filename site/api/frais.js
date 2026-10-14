import { exigerSession } from './_lib/auth.js';
import { db, echec, ok } from './_lib/db.js';

// POST { le, libelle, montant }  ·  DELETE ?id=
export default async function handler(req, res) {
  if (!exigerSession(req, res)) return;
  try {
    if (req.method === 'POST') {
      const { le, libelle, montant } = req.body || {};
      if (!libelle || !(Number(montant) >= 0)) return res.status(400).json({ erreur: 'Libellé et montant obligatoires.' });
      const [ligne] = ok(await db().from('frais').insert({ le: le || undefined, libelle: String(libelle).slice(0, 200), montant: Number(montant) }).select());
      return res.json({ frais: ligne });
    }
    if (req.method === 'DELETE') {
      ok(await db().from('frais').delete().eq('id', req.query.id));
      return res.json({ ok: true });
    }
    res.status(405).end();
  } catch (e) {
    echec(res, e);
  }
}
