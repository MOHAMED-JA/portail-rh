/* ==========================================================================
   31. TÉLÉCHARGEMENTS RÉELS
   Les documents sont produits par le serveur (PDF via ReportLab, Excel via
   openpyxl) et remis au navigateur, qui les dépose dans le dossier de
   téléchargement habituel. Sans serveur, le bouton l'explique au lieu de
   faire semblant.
   ========================================================================== */
async function telechargerFichier(chemin, nomPropose, libelle) {
  // La version publiée en ligne s'exécute dans un cadre qui interdit les
  // enregistrements de fichiers : autant le dire que d'échouer en silence.
  if (location.hostname.endsWith("claude.ai")) {
    return toast("Téléchargement impossible ici",
      `${libelle} : la version en ligne n'a pas le droit d'enregistrer de fichier. Ouvrez l'application locale (http://localhost:8000).`,
      "alerte");
  }
  if (!connecte()) {
    return toast("Document indisponible",
      `${libelle} est produit par le serveur. Lancez DEMARRER.bat pour l'obtenir.`, "alerte");
  }
  toast("Préparation du document", `${libelle} — génération en cours…`, "info");
  try {
    const reponse = await fetch(API.base + chemin, { headers: { Authorization: `Bearer ${API.token}` } });
    if (!reponse.ok) {
      const souci = await reponse.json().catch(() => null);
      throw new Error((souci && souci.detail) || `Erreur ${reponse.status}`);
    }
    // Le nom réel est proposé par le serveur dans l'en-tête Content-Disposition.
    const entete = reponse.headers.get("Content-Disposition") || "";
    const trouve = entete.match(/filename="?([^"]+)"?/);
    const nom = trouve ? trouve[1] : nomPropose;

    const contenu = await reponse.blob();
    const adresse = URL.createObjectURL(contenu);
    const lien = document.createElement("a");
    lien.href = adresse;
    lien.download = nom;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(adresse), 4000);

    toast("Document téléchargé", `${nom} — dans votre dossier Téléchargements.`, "succes");
  } catch (souci) {
    toast("Téléchargement impossible", souci.message, "danger");
  }
}

/* Les documents de l'espace personnel : seuls ceux que le serveur sait
   produire sont proposés au téléchargement. */
function cheminDocument(doc) {
  if (doc.categorie === "attestation") {
    return { chemin: "/api/exports/attestation-travail.pdf", nom: "attestation-travail.pdf" };
  }
  if (doc.titre.toLowerCase().includes("solde")) {
    return { chemin: "/api/exports/solde.pdf", nom: "attestation-solde.pdf" };
  }
  return null;
}

BRANCHEMENTS["/documents"] = function () {
  $$("[data-signer]").forEach((b) => b.addEventListener("click", () => ouvrirSignature(b.dataset.signer)));
  $$("[data-doc]").forEach((b) => {
    const doc = DOCUMENTS.find((d) => d.id === Number(b.dataset.doc));
    const cible = cheminDocument(doc);
    const remplacant = b.cloneNode(true);
    b.parentNode.replaceChild(remplacant, b);
    remplacant.addEventListener("click", () => {
      if (cible) return telechargerFichier(cible.chemin, cible.nom, doc.titre);
      if (doc.categorie === "bulletin") {
        return toast("Bulletin non disponible",
          "Les bulletins de paie proviendront du logiciel de paie : le raccordement reste à faire.", "alerte");
      }
      toast("Document non disponible", `${doc.titre} n'est pas encore produit par le serveur.`, "alerte");
    });
  });
};

/* Justificatif PDF depuis le détail d'une demande. */
const ouvrirDetailDemandeSansPdf = ouvrirDetailDemande;
ouvrirDetailDemande = function (ref) {
  ouvrirDetailDemandeSansPdf(ref);
  const demande = DEMANDES.find((d) => d.ref === ref);
  const bouton = $("#pdf-demande");
  if (!bouton || !demande) return;
  const remplacant = bouton.cloneNode(true);
  bouton.parentNode.replaceChild(remplacant, bouton);
  remplacant.addEventListener("click", () =>
    telechargerFichier(`/api/exports/demande/${demande.id}.pdf`, `${demande.ref}.pdf`, `Justificatif ${demande.ref}`));
};

/* Espace personnel : exports du profil. */
const brancherProfil = BRANCHEMENTS["/profil"];
BRANCHEMENTS["/profil"] = function () {
  brancherProfil();
  const exports = {
    "Historique complet (Excel)": { chemin: "/api/exports/demandes.xlsx", nom: "mes-demandes.xlsx" },
    "Attestation de solde (PDF)": { chemin: "/api/exports/solde.pdf", nom: "attestation-solde.pdf" },
    "Relevé de pointages (PDF)": { chemin: "/api/exports/pointages.xlsx", nom: "mes-pointages.xlsx" },
  };
  $$("[data-export-perso]").forEach((b) => {
    const cible = exports[b.dataset.exportPerso];
    const remplacant = b.cloneNode(true);
    b.parentNode.replaceChild(remplacant, b);
    remplacant.addEventListener("click", () => telechargerFichier(cible.chemin, cible.nom, b.dataset.exportPerso));
  });
};

/* Administration : registre, pointages, synthèse, attestations. */
const brancherAdministration = BRANCHEMENTS["/administration"];
BRANCHEMENTS["/administration"] = function () {
  if (brancherAdministration) brancherAdministration();
  const exports = {
    "Registre des demandes (Excel)": { chemin: "/api/exports/demandes.xlsx", nom: "registre-demandes.xlsx" },
    "Pointages du mois (Excel)": { chemin: "/api/exports/pointages.xlsx", nom: "pointages.xlsx" },
    "Synthèse RH (PDF)": { chemin: "/api/exports/synthese.pdf", nom: "synthese-rh.pdf" },
    "Attestations de solde (PDF)": { chemin: "/api/exports/solde.pdf", nom: "attestation-solde.pdf" },
  };
  $$("[data-export]").forEach((b) => {
    const cible = exports[b.dataset.export];
    if (!cible) return;
    const remplacant = b.cloneNode(true);
    b.parentNode.replaceChild(remplacant, b);
    remplacant.addEventListener("click", () => telechargerFichier(cible.chemin, cible.nom, b.dataset.export));
  });
};

/* Rapports : le PDF de direction et le détail Excel. */
const brancherRapports = BRANCHEMENTS["/rapports"];
BRANCHEMENTS["/rapports"] = function () {
  brancherRapports();
  const exports = {
    "Rapport d'activité (PDF)": { chemin: "/api/exports/synthese.pdf", nom: "synthese-rh.pdf" },
    "Données détaillées (Excel)": { chemin: "/api/exports/pointages.xlsx", nom: "donnees-detaillees.xlsx" },
  };
  $$("[data-export-rapport]").forEach((b) => {
    const cible = exports[b.dataset.exportRapport];
    const remplacant = b.cloneNode(true);
    b.parentNode.replaceChild(remplacant, b);
    remplacant.addEventListener("click", () => telechargerFichier(cible.chemin, cible.nom, b.dataset.exportRapport));
  });
};

/* Présences : export du mois affiché. */
const brancherPresencesSansExport = brancherVueCourante;
brancherVueCourante = function () {
  brancherPresencesSansExport();
  if (etat.route !== "/presences") return;
  const bouton = $("#export-mensuel");
  if (!bouton) return;
  const remplacant = bouton.cloneNode(true);
  bouton.parentNode.replaceChild(remplacant, bouton);
  remplacant.addEventListener("click", () => {
    const mois = etat.filtres.presences.mois;
    const debut = iso(new Date(ANNEE, mois, 1));
    const fin = iso(new Date(ANNEE, mois + 1, 0));
    telechargerFichier(`/api/exports/pointages.xlsx?debut=${debut}&fin=${fin}`,
      `pointages-${MOIS[mois]}.xlsx`, `Pointages de ${MOIS[mois]}`);
  });
};
