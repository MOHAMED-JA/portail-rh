/* ==========================================================================
   32. EFFECTIF RÉEL — ajustements lorsque la base contient l'annuaire
   ========================================================================== */

/* Écran de connexion : les comptes de démonstration n'existent pas en base. */
const injecterBandeauSansComptes = injecterBandeauMode;
injecterBandeauMode = function () {
  injecterBandeauSansComptes();
  const boite = $(".connexion-boite");
  if (!boite || etat.mode !== "connecte") return;
  [".comptes-demo", ".separateur"].forEach((sel) => { const el = $(sel, boite); if (el) el.remove(); });
  const mention = [...boite.querySelectorAll("p")].find((p) => p.textContent.includes("Mot de passe de démonstration"));
  if (mention) mention.textContent = "Utilisez votre matricule Veltaris et le mot de passe communiqué par la RH.";
  const champ = $("#matricule");
  if (champ) champ.placeholder = "Votre matricule";
};

/* Documents : chaque collaborateur dispose de ses deux attestations, produites
   par le serveur. Aucun bulletin ni contrat fictif n'est affiché. */
const chargerDonneesSansDocuments = chargerDonneesApi;
chargerDonneesApi = async function () {
  await chargerDonneesSansDocuments();
  // Le dossier réel est servi par l'API. Ne jamais rendre la connexion
  // dépendante de la liste locale employée uniquement en démonstration.
  if (typeof DOCUMENTS === "undefined") return;
  const matricule = etat.utilisateur.matricule;
  for (let i = DOCUMENTS.length - 1; i >= 0; i--) if (DOCUMENTS[i].matricule === matricule) DOCUMENTS.splice(i, 1);
  DOCUMENTS.push(
    { id: 900001, matricule, titre: "Attestation de travail", categorie: "attestation", periode: String(ANNEE),
      signe: false, signable: false, date: new Date() },
    { id: 900002, matricule, titre: "Attestation de solde de congés", categorie: "attestation", periode: String(ANNEE),
      signe: false, signable: false, date: new Date() },
  );
};

cheminDocument = function (doc) {
  if (doc.titre.toLowerCase().includes("solde")) return { chemin: "/api/exports/solde.pdf", nom: "attestation-solde.pdf" };
  if (doc.categorie === "attestation") return { chemin: "/api/exports/attestation-travail.pdf", nom: "attestation-travail.pdf" };
  return null;
};

/* Création de profil : proposer le matricule libre suivant. */
const ouvrirFicheSansMatricule = ouvrirFicheEmploye;
ouvrirFicheEmploye = function (matricule) {
  ouvrirFicheSansMatricule(matricule);
  if (matricule) return;
  const numeriques = EMPLOYES.map((e) => Number(e.matricule)).filter(Number.isFinite);
  const champ = $("#e-matricule");
  if (champ && numeriques.length) champ.value = String(Math.max(...numeriques) + 1);
};

/* Tableau de bord d'un dossier qui démarre : un état vide plutôt que des
   graphiques à zéro. */
const graphiquesAvecDonnees = graphiquesTableauBord;
graphiquesTableauBord = function () {
  if (mesPointages().length) return graphiquesAvecDonnees();
  const message = etatVide("horloge", "Aucun pointage enregistré",
    "Les graphiques de présence et de ponctualité apparaîtront dès les premiers badgeages.");
  ["#g-absences", "#g-retards", "#g-heures"].forEach((sel) => {
    const zone = $(sel);
    if (!zone) return;
    const carte = zone.closest(".carte");
    const boite = zone.closest(".boite-graph");
    boite.outerHTML = message;
    const legende = carte.querySelector(".legende");
    if (legende) legende.remove();
  });
};
