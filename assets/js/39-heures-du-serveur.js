/* ==========================================================================
   39. HEURES DU SERVEUR
   Le serveur enregistre les horodatages en temps universel (UTC) sans
   suffixe : ils sont convertis en heure locale (Tunis) à la lecture.
   ========================================================================== */
const dateServeur = (valeur) => {
  if (!valeur) return null;
  const texte = String(valeur);
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(texte) || texte.length <= 10 ? texte : `${texte}Z`);
};
const versNotificationLocaleUTC = versNotificationLocale;
versNotificationLocale = function (n, matricule) {
  return { ...versNotificationLocaleUTC(n, matricule), date: dateServeur(n.horodatage) };
};
const versDemandeLocaleUTC = versDemandeLocale;
versDemandeLocale = function (d) {
  const locale = versDemandeLocaleUTC(d);
  locale.cree = dateServeur(d.cree_le);
  locale.dateValidation = dateServeur(d.date_validation);
  locale.historique = (d.historique || []).map((h, i) => ({ ...locale.historique[i], date: dateServeur(h.horodatage) }));
  return locale;
};
const versNoteLocaleUTC = versNoteLocale;
versNoteLocale = function (n) { return { ...versNoteLocaleUTC(n), cree: dateServeur(n.cree_le) }; };
const chargerJournalUTC = chargerJournal;
chargerJournal = async function () {
  await chargerJournalUTC();
  JOURNAL.forEach((j) => { if (j.date instanceof Date && !j.corrigee) { j.date = new Date(j.date.getTime() - j.date.getTimezoneOffset() * 60000); j.corrigee = true; } });
};
