/** Montant converti en euros au taux de la BCE du jour d'achat, ou null si le service ne répond pas. */
export async function enEuros(montant, devise, date) {
  if (montant == null) return null;
  if (!devise || devise === 'EUR') return Number(montant);
  try {
    const jour = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : 'latest';
    const r = await fetch(`https://api.frankfurter.app/${jour}?amount=${montant}&from=${encodeURIComponent(devise)}&to=EUR`);
    if (!r.ok) return null;
    const j = await r.json();
    return j.rates && j.rates.EUR != null ? Math.round(j.rates.EUR * 100) / 100 : null;
  } catch {
    return null;
  }
}
