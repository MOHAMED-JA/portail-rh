/* ==========================================================================
   82 — Pièces jointes et sessions protégées (version 1.37.0)
   - Les pièces (/fichiers/…) ne sont plus servies qu'à une personne
     connectée et concernée : un simple lien ne porte pas le jeton. Chaque
     clic sur un lien de pièce passe donc par l'API avec le jeton ; un PDF
     s'ouvre dans un nouvel onglet, un document Word se télécharge.
   - Changer son mot de passe ferme les autres sessions : le serveur renvoie
     un nouveau jeton, qui remplace aussitôt l'ancien.
   - « Mot de passe oublié » répond de la même façon pour tous les matricules :
     l'accès par la double authentification est proposé à chacun.
   ========================================================================== */
async function ouvrirPieceProtegee(lien) {
  if (!connecte()) {
    return toast("Pièce indisponible", "Les pièces jointes sont conservées sur le serveur : connectez-vous au portail.", "alerte");
  }
  const adresse = new URL(lien.href, location.href);
  const chemin = adresse.pathname;
  const estPdf = chemin.toLowerCase().endsWith(".pdf");
  // Ouvert tout de suite, pendant le clic : sinon le navigateur bloque la fenêtre.
  const onglet = estPdf ? window.open("about:blank", "_blank") : null;
  try {
    const reponse = await fetch(API.base + chemin, { headers: { Authorization: `Bearer ${API.token}` } });
    if (!reponse.ok) {
      const souci = await reponse.json().catch(() => null);
      throw new Error((souci && souci.detail) || `Erreur ${reponse.status}`);
    }
    const url = URL.createObjectURL(await reponse.blob());
    if (onglet) {
      onglet.location.href = url;
    } else {
      const texte = lien.textContent.trim();
      const telechargement = document.createElement("a");
      telechargement.href = url;
      telechargement.download = /\.docx?$/i.test(texte) ? texte : chemin.split("/").pop();
      document.body.appendChild(telechargement);
      telechargement.click();
      telechargement.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (souci) {
    if (onglet) onglet.close();
    toast("Pièce inaccessible", souci.message, "danger");
  }
}

document.addEventListener("click", (evenement) => {
  const lien = evenement.target.closest && evenement.target.closest('a[href*="/fichiers/"]');
  if (!lien) return;
  evenement.preventDefault();
  evenement.stopPropagation();
  ouvrirPieceProtegee(lien);
}, true);

/* --- Nouveau jeton après un changement de mot de passe ------------------------ */
const appelAvantSessionRenouvelee = API.appel;
API.appel = async function (chemin, options) {
  const reponse = await appelAvantSessionRenouvelee.call(API, chemin, options);
  if (chemin === "/api/auth/mot-de-passe" && reponse && reponse.access_token) API.token = reponse.access_token;
  return reponse;
};

/* --- Mot de passe oublié : même réponse pour tous, double authentification proposée --- */
const finOubliAvantDoubleAuth = finOubli;
finOubli = function (boite, titre, message) {
  const champ = boite.querySelector("#oubli-matricule");
  const matricule = champ ? champ.value.trim().toUpperCase() : "";
  finOubliAvantDoubleAuth(boite, matricule ? "Demande enregistrée" : titre, message);
  if (!matricule) return;   // fin d'un autre parcours (lien, double authentification)
  const pied = boite.querySelector(".modale-pied");
  pied.insertAdjacentHTML("afterbegin",
    `<button class="btn" id="oubli-double-auth">${ico("bouclier")} J'ai la double authentification</button>`);
  pied.querySelector("#oubli-double-auth").addEventListener("click", () => etapeDoubleAuth(boite, matricule,
    "Saisissez le code affiché par votre application, puis l'un de vos codes de secours, et choisissez un nouveau mot de passe."));
};
