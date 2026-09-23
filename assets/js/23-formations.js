/* ==========================================================================
   23. FORMATIONS
   ========================================================================== */
const THEMES_FORMATION = ["Technique", "Conformité", "Management", "Relationnel", "Bureautique", "Sécurité"];
const COULEUR_THEME = {
  Technique: "var(--marine)", Conformité: "var(--danger)", Management: "var(--violet)",
  Relationnel: "var(--succes)", Bureautique: "var(--info)", Sécurité: "var(--alerte)",
};

VUES["/formations"] = function () {
  const f = etat.filtres.formations || (etat.filtres.formations = { theme: "", mesFormations: false });
  let liste = [...FORMATIONS].sort((a, b) => a.debut.localeCompare(b.debut));
  if (f.theme) liste = liste.filter((x) => x.theme === f.theme);
  if (f.mesFormations) liste = liste.filter((x) => x.inscrits.includes(moi().matricule));

  const miennes = FORMATIONS.filter((x) => x.inscrits.includes(moi().matricule));
  const aVenir = miennes.filter((x) => depuisIso(x.debut) >= AUJOURDHUI);
  const joursFormation = miennes.reduce((s, x) => s + x.jours, 0);

  return `
  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
    ${carteKpi({ cle: "fo1", libelle: "Mes formations à venir", valeur: aVenir.length, unite: "", icone: "doc", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: aVenir.length ? `Prochaine : ${fmtDate(aVenir[0].debut)}` : "Aucune session programmée" })}
    ${carteKpi({ cle: "fo2", libelle: "Jours de formation", valeur: joursFormation, unite: "j", icone: "calendrier", couleur: "var(--succes)", fond: "var(--succes-doux)", detail: `Objectif annuel : 5 jours` })}
    ${carteKpi({ cle: "fo3", libelle: "Sessions au catalogue", valeur: FORMATIONS.length, unite: "", icone: "users", couleur: "var(--violet)", fond: "var(--violet-doux)", detail: `${THEMES_FORMATION.length} thématiques` })}
    ${carteKpi({ cle: "fo4", libelle: "Places disponibles", valeur: FORMATIONS.reduce((s, x) => s + Math.max(0, x.places - x.inscrits.length), 0), unite: "", icone: "check", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: "Toutes sessions confondues" })}
  </section>

  <section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      <h2>Catalogue de formation ${ANNEE}</h2>
      <div class="barre-filtres" style="margin-left:auto">
        <div class="segment" id="formation-theme">
          <button data-valeur="" class="${f.theme === "" ? "actif" : ""}">Toutes</button>
          ${THEMES_FORMATION.map((t) => `<button data-valeur="${t}" class="${f.theme === t ? "actif" : ""}">${t}</button>`).join("")}
        </div>
        <button class="btn petit ${f.mesFormations ? "primaire" : ""}" id="formation-miennes">${ico("check")} Mes inscriptions</button>
      </div>
    </div>

    ${liste.length ? `<div class="grille" style="grid-template-columns:repeat(auto-fill,minmax(310px,1fr))">
      ${liste.map((x) => {
        const inscrit = x.inscrits.includes(moi().matricule);
        const restantes = Math.max(0, x.places - x.inscrits.length);
        const passee = depuisIso(x.fin) < AUJOURDHUI;
        const remplissage = Math.min(100, (x.inscrits.length / x.places) * 100);
        return `<article class="carte" style="box-shadow:none;border-left:3px solid ${COULEUR_THEME[x.theme]};display:flex;flex-direction:column;gap:11px">
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;flex-wrap:wrap">
              <span class="badge neutre" style="color:${COULEUR_THEME[x.theme]}"><span class="point" style="background:${COULEUR_THEME[x.theme]}"></span>${x.theme}</span>
              ${passee ? `<span class="badge annulee">Session passée</span>` : inscrit ? `<span class="badge approuvee">${ico("check")} Inscrit</span>` : restantes === 0 ? `<span class="badge rejetee">Complet</span>` : ""}
            </div>
            <h3 style="font-size:15px">${echapper(x.titre)}</h3>
            <p style="font-size:12.5px;color:var(--encre-2);margin-top:5px">${echapper(x.description)}</p>
          </div>

          <div style="font-size:12px;color:var(--encre-3);display:flex;flex-direction:column;gap:4px">
            <span>${ico("calendrier")} ${fmtDate(x.debut)}${x.jours > 1 ? ` → ${fmtDate(x.fin)}` : ""} · ${x.jours} jour(s)</span>
            <span>${ico("batiment")} ${echapper(x.lieu)}</span>
            <span>${ico("users")} ${echapper(x.formateur)}</span>
          </div>

          <div>
            <div class="jauge ${remplissage > 85 ? "alerte" : ""}"><span style="width:${remplissage}%"></span></div>
            <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--encre-3);margin-top:5px">
              <span>${x.inscrits.length} / ${x.places} inscrits</span>
              <span>${restantes} place(s) restante(s)</span>
            </div>
          </div>

          <button class="btn ${inscrit ? "" : "primaire"} btn-bloc" data-formation="${x.id}" ${passee || (!inscrit && restantes === 0) ? "disabled" : ""} style="margin-top:auto">
            ${inscrit ? `${ico("croix")} Me désinscrire` : `${ico("plus")} M'inscrire`}
          </button>
        </article>`;
      }).join("")}
    </div>` : etatVide("doc", "Aucune formation sur ce filtre", "Changez de thématique ou consultez tout le catalogue.")}
  </section>`;
};

BRANCHEMENTS["/formations"] = function () {
  const f = etat.filtres.formations;
  $$("#formation-theme button").forEach((b) => b.addEventListener("click", () => { f.theme = b.dataset.valeur; rendre(false); }));
  $("#formation-miennes").addEventListener("click", () => { f.mesFormations = !f.mesFormations; rendre(false); });
  $$("[data-formation]").forEach((b) => b.addEventListener("click", () => basculerInscription(Number(b.dataset.formation))));
};

function basculerInscription(id) {
  const formation = FORMATIONS.find((x) => x.id === id);
  const matricule = moi().matricule;
  const index = formation.inscrits.indexOf(matricule);

  if (index >= 0) {
    formation.inscrits.splice(index, 1);
    toast("Désinscription enregistrée", `${formation.titre} — votre place est libérée.`, "info");
  } else {
    if (formation.inscrits.length >= formation.places) return toast("Session complète", "Aucune place disponible sur cette session.", "danger");
    formation.inscrits.push(matricule);
    if (moi().validateur) {
      NOTIFICATIONS.unshift({
        id: idNotif++, matricule: moi().validateur, titre: "Inscription à une formation",
        message: `${nomComplet(moi())} s'est inscrit à « ${formation.titre} » (${fmtDate(formation.debut)}).`,
        type: "info", lien: "/formations", lu: false, date: new Date(),
      });
    }
    toast("Inscription confirmée", `${formation.titre} · ${fmtDateLongue(formation.debut)} — ${formation.lieu}.`, "succes");
  }
  rendre(false);
}

/* ==========================================================================
   24. NOTES DE FRAIS
   ========================================================================== */
const STATUTS_FRAIS = {
  brouillon: ["annulee", "Brouillon"], en_attente: ["attente", "En attente"],
  approuvee: ["approuvee", "Approuvée"], remboursee: ["info", "Remboursée"], rejetee: ["rejetee", "Rejetée"],
};
const dinars = (montant) => `${montant.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;

VUES["/notes-de-frais"] = function () {
  const f = etat.filtres.frais || (etat.filtres.frais = { onglet: "miennes" });
  const miennes = NOTES_FRAIS.filter((n) => n.matricule === moi().matricule).sort((a, b) => b.cree - a.cree);
  const equipe = NOTES_FRAIS.filter((n) => n.statut === "en_attente" && n.matricule !== moi().matricule && peutDeciderNote(n));
  const aRembourser = estAdmin() ? NOTES_FRAIS.filter((n) => n.statut === "approuvee" && parMatricule[n.matricule]) : [];

  const remboursees = miennes.filter((n) => n.statut === "remboursee");
  const enAttente = miennes.filter((n) => n.statut === "en_attente");
  const liste = f.onglet === "equipe" ? equipe : f.onglet === "rembourser" ? aRembourser : miennes;

  return `
  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
    ${carteKpi({ cle: "nf1", libelle: `Remboursé en ${ANNEE}`, valeur: fmtNombre(remboursees.reduce((s, n) => s + n.total, 0), 0), unite: "DT", icone: "telecharger", couleur: "var(--succes)", fond: "var(--succes-doux)", detail: `${remboursees.length} note(s) réglée(s)` })}
    ${carteKpi({ cle: "nf2", libelle: "En attente de validation", valeur: fmtNombre(enAttente.reduce((s, n) => s + n.total, 0), 0), unite: "DT", icone: "horloge", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: `${enAttente.length} note(s) transmise(s)` })}
    ${carteKpi({ cle: "nf3", libelle: "Notes déposées", valeur: miennes.length, unite: "", icone: "doc", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: "Depuis le début de l'année" })}
    ${estValideur() ? carteKpi({ cle: "nf4", libelle: "À valider (équipe)", valeur: equipe.length, unite: "", icone: "inbox", couleur: "var(--violet)", fond: "var(--violet-doux)", detail: fmtNombre(equipe.reduce((s, n) => s + n.total, 0), 0) + " DT au total" }) : ""}
  </section>

  <section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      ${estValideur() ? `<div class="segment" id="frais-onglets">
        <button data-onglet="miennes" class="${f.onglet === "miennes" ? "actif" : ""}">Mes notes</button>
        <button data-onglet="equipe" class="${f.onglet === "equipe" ? "actif" : ""}">À valider${equipe.length ? ` (${equipe.length})` : ""}</button>
        ${estAdmin() ? `<button data-onglet="rembourser" class="${f.onglet === "rembourser" ? "actif" : ""}">À rembourser${aRembourser.length ? ` (${aRembourser.length})` : ""}</button>` : ""}
      </div>` : `<h2>Mes notes de frais</h2>`}
      <button class="btn primaire petit" id="nouvelle-note" style="margin-left:auto">${ico("plus")} Nouvelle note de frais</button>
    </div>

    ${liste.length ? `<div class="tableau-boite">
      <table style="min-width:720px">
        <thead><tr>
          <th>Référence</th>${f.onglet !== "miennes" ? "<th>Collaborateur</th>" : ""}<th>Période</th>
          <th class="centre">Lignes</th><th class="droite">Montant</th><th>Statut</th><th class="droite">Actions</th>
        </tr></thead>
        <tbody>
          ${liste.map((n) => {
            const e = parMatricule[n.matricule];
            const [cls, libelle] = STATUTS_FRAIS[n.statut];
            return `<tr class="cliquable" data-note="${n.id}">
              <td class="mono" style="font-size:12px">${n.reference}</td>
              ${f.onglet !== "miennes" ? `<td><div style="display:flex;align-items:center;gap:8px"><div class="avatar s" style="background:${couleurDept(e.dept)}">${initiales(e)}</div>${echapper(nomComplet(e))}</div></td>` : ""}
              <td class="mono">${n.periode}</td>
              <td class="centre num">${n.lignes.length}</td>
              <td class="droite num"><strong>${dinars(n.total)}</strong></td>
              <td><span class="badge ${cls}">${libelle}</span></td>
              <td class="droite" style="white-space:nowrap">
                ${f.onglet === "rembourser"
                  ? `<button class="btn petit succes" data-frais-rembourser="${n.id}">${ico("check")} Remboursée</button>`
                  : f.onglet === "equipe"
                  ? `<button class="btn petit succes" data-frais-ok="${n.id}" title="Approuver">${ico("check")}</button>
                     <button class="btn petit danger" data-frais-ko="${n.id}" title="Refuser">${ico("croix")}</button>`
                  : n.statut === "brouillon" ? `<button class="btn petit primaire" data-frais-envoyer="${n.id}">Transmettre</button>` : ico("chevronD")}
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>` : etatVide("doc", f.onglet === "equipe" ? "Aucune note à valider" : f.onglet === "rembourser" ? "Aucune note à rembourser" : "Aucune note de frais",
      f.onglet === "equipe" ? "Les notes transmises par votre équipe apparaîtront ici."
        : f.onglet === "rembourser" ? "Les notes approuvées par les supérieurs apparaîtront ici."
        : "Déposez vos frais de mission : transport, repas, hébergement et carburant.",
      f.onglet !== "miennes" ? "" : `<button class="btn primaire" id="nouvelle-note-vide" style="margin-top:10px">${ico("plus")} Créer ma première note</button>`)}
  </section>`;
};

BRANCHEMENTS["/notes-de-frais"] = function () {
  const f = etat.filtres.frais;
  $$("#frais-onglets button").forEach((b) => b.addEventListener("click", () => { f.onglet = b.dataset.onglet; rendre(false); }));
  [$("#nouvelle-note"), $("#nouvelle-note-vide")].forEach((b) => b && b.addEventListener("click", ouvrirNouvelleNote));
  $$("[data-note]").forEach((l) => l.addEventListener("click", (ev) => {
    if (ev.target.closest("button")) return;
    ouvrirDetailNote(Number(l.dataset.note));
  }));
  $$("[data-frais-ok]").forEach((b) => b.addEventListener("click", () => deciderNote(Number(b.dataset.fraisOk), true)));
  $$("[data-frais-ko]").forEach((b) => b.addEventListener("click", () => deciderNote(Number(b.dataset.fraisKo), false)));
  $$("[data-frais-envoyer]").forEach((b) => b.addEventListener("click", () => {
    const note = NOTES_FRAIS.find((n) => n.id === Number(b.dataset.fraisEnvoyer));
    if (connecte()) return actionNoteApi(`/api/frais/${note.id}/transmettre`, "Note transmise", `${note.reference} envoyée à votre supérieur.`);
    note.statut = "en_attente";
    if (moi().validateur) {
      NOTIFICATIONS.unshift({ id: idNotif++, matricule: moi().validateur, titre: "Note de frais à valider",
        message: `${nomComplet(moi())} — ${note.reference} (${dinars(note.total)})`, type: "validation", lien: "/notes-de-frais", lu: false, date: new Date() });
    }
    toast("Note transmise", `${note.reference} · ${dinars(note.total)} envoyée à la validation.`, "succes");
    rendre(false);
  }));
};

function ouvrirNouvelleNote() {
  const lignes = [{ date: iso(AUJOURDHUI), categorie: "transport", libelle: "", montant: 0 }];

  const dessinerLignes = () => {
    $("#frais-lignes").innerHTML = lignes.map((l, i) => `
      <div class="frais-ligne" data-index="${i}">
        <input class="saisie" type="date" value="${l.date}" data-champ="date">
        <select class="saisie" data-champ="categorie">
          ${Object.entries(CATEGORIES_FRAIS).map(([cle, [libelle]]) => `<option value="${cle}" ${l.categorie === cle ? "selected" : ""}>${libelle}</option>`).join("")}
        </select>
        <input class="saisie" placeholder="Libellé" value="${echapper(l.libelle)}" data-champ="libelle">
        <input class="saisie num" type="number" step="0.001" min="0" value="${l.montant}" data-champ="montant" style="text-align:right">
        <button class="btn petit icone fantome" data-supprimer="${i}" aria-label="Supprimer la ligne" ${lignes.length === 1 ? "disabled" : ""}>${ico("poubelle")}</button>
      </div>`).join("");

    $$("#frais-lignes .frais-ligne").forEach((ligne) => {
      const index = Number(ligne.dataset.index);
      $$("[data-champ]", ligne).forEach((champ) => champ.addEventListener("input", () => {
        lignes[index][champ.dataset.champ] = champ.dataset.champ === "montant" ? Number(champ.value) : champ.value;
        majTotal();
      }));
    });
    $$("[data-supprimer]").forEach((b) => b.addEventListener("click", () => {
      lignes.splice(Number(b.dataset.supprimer), 1); dessinerLignes(); majTotal();
    }));
    majTotal();
  };
  const majTotal = () => {
    const total = lignes.reduce((s, l) => s + (Number(l.montant) || 0), 0);
    $("#frais-total").textContent = dinars(Math.round(total * 1000) / 1000);
  };

  ouvrirCouche(`
    <aside class="tiroir" role="dialog" aria-modal="true" style="width:min(760px,100%)">
      ${enteteTiroir("Nouvelle note de frais", "Frais de mission — remboursement sur justificatifs")}
      <div class="tiroir-corps">
        <div class="ligne-champs">
          <div class="champ"><label for="frais-periode">Période</label>
            <input class="saisie" id="frais-periode" value="${String(AUJOURDHUI.getMonth() + 1).padStart(2, "0")}/${ANNEE}" readonly></div>
          <div class="champ"><label for="frais-mission">Mission rattachée</label>
            <select class="saisie" id="frais-mission">
              <option value="">Aucune</option>
              ${DEMANDES.filter((d) => d.matricule === moi().matricule && d.type === "mission").slice(0, 8)
                .map((d) => `<option value="${d.ref}">${echapper(libelleType(d.type, d.sousType))} — ${fmtDate(d.debut)}</option>`).join("")}
            </select></div>
        </div>

        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">
            <h3>Dépenses</h3>
            <button class="btn petit" id="ajouter-ligne">${ico("plus")} Ajouter une ligne</button>
          </div>
          <div class="frais-entetes">
            <span>Date</span><span>Catégorie</span><span>Libellé</span><span style="text-align:right">Montant (DT)</span><span></span>
          </div>
          <div id="frais-lignes" style="display:flex;flex-direction:column;gap:7px"></div>
        </div>

        <div class="champ">
          <label for="frais-justificatifs">Justificatifs</label>
          <input class="saisie" type="file" id="frais-justificatifs" multiple accept=".pdf,.doc,.docx">
          <span class="aide">PDF, DOC ou DOCX uniquement. Les originaux restent à remettre au service comptabilité.</span>
        </div>

        <div class="carte" style="background:var(--surface-2);padding:14px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12.5px;color:var(--encre-2);font-weight:600">Total à rembourser</span>
          <strong id="frais-total" style="font-family:var(--police-titre);font-size:22px">0,000 DT</strong>
        </div>
      </div>
      <div class="tiroir-pied">
        <button class="btn" id="frais-annuler">Annuler</button>
        <button class="btn" id="frais-brouillon">Enregistrer en brouillon</button>
        <button class="btn primaire" id="frais-transmettre">${ico("check")} Transmettre</button>
      </div>
    </aside>`, { tiroir: true });

  dessinerLignes();
  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#frais-annuler").addEventListener("click", fermerCouche);
  $("#ajouter-ligne").addEventListener("click", () => {
    lignes.push({ date: iso(AUJOURDHUI), categorie: "repas", libelle: "", montant: 0 });
    dessinerLignes();
  });

  const enregistrer = (statut) => {
    const valides = lignes.filter((l) => l.montant > 0);
    if (!valides.length) return toast("Note vide", "Renseignez au moins une dépense avec un montant.", "danger");
    if (connecte()) return enregistrerNoteApi(statut, valides, $("#frais-periode").value, $("#frais-mission").value, $("#frais-justificatifs").files);
    const note = {
      id: idFrais++, matricule: moi().matricule, reference: `NF-${ANNEE}-${1500 + idFrais}`,
      periode: $("#frais-periode").value, lignes: valides, statut,
      total: Math.round(valides.reduce((s, l) => s + l.montant, 0) * 1000) / 1000, cree: new Date(),
    };
    NOTES_FRAIS.unshift(note);
    if (statut === "en_attente" && moi().validateur) {
      NOTIFICATIONS.unshift({ id: idNotif++, matricule: moi().validateur, titre: "Note de frais à valider",
        message: `${nomComplet(moi())} — ${note.reference} (${dinars(note.total)})`, type: "validation", lien: "/notes-de-frais", lu: false, date: new Date() });
    }
    fermerCouche();
    toast(statut === "brouillon" ? "Brouillon enregistré" : "Note transmise",
      `${note.reference} · ${dinars(note.total)}`, "succes");
    rendre(false);
  };
  $("#frais-brouillon").addEventListener("click", () => enregistrer("brouillon"));
  $("#frais-transmettre").addEventListener("click", () => enregistrer("en_attente"));
}

function ouvrirDetailNote(id) {
  const n = NOTES_FRAIS.find((x) => x.id === id);
  const e = parMatricule[n.matricule];
  const [cls, libelle] = STATUTS_FRAIS[n.statut];

  ouvrirCouche(`
    <div class="modale large" role="dialog" aria-modal="true">
      <div class="modale-tete">
        <div><h2>${n.reference}</h2><div class="sous">${echapper(nomComplet(e))} · période ${n.periode}</div></div>
        <span class="badge ${cls}" style="margin-left:auto">${libelle}</span>
      </div>
      <div class="modale-corps">
        <div class="tableau-boite">
          <table style="min-width:520px">
            <thead><tr><th>Date</th><th>Catégorie</th><th>Libellé</th><th class="droite">Montant</th></tr></thead>
            <tbody>
              ${n.lignes.map((l) => {
                const [libelleCat, icone, couleur, fond] = CATEGORIES_FRAIS[l.categorie];
                return `<tr>
                  <td class="mono">${fmtDate(l.date)}</td>
                  <td><span class="badge neutre" style="color:${couleur};background:${fond}">${ico(icone)}${libelleCat}</span></td>
                  <td>${echapper(l.libelle || "—")}</td>
                  <td class="droite num">${dinars(l.montant)}</td>
                </tr>`;
              }).join("")}
              <tr><td colspan="3" style="text-align:right;font-weight:600">Total</td>
                  <td class="droite num"><strong style="font-size:15px">${dinars(n.total)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="modale-pied">
        <button class="btn" id="note-fermer">Fermer</button>
        <button class="btn" id="note-pdf">${ico("telecharger")} Export PDF</button>
      </div>
    </div>`);
  $("#note-fermer").addEventListener("click", fermerCouche);
  $("#note-pdf").addEventListener("click", () => toast("Export PDF", `${n.reference} — état de frais aux couleurs de la marque Assurance.`, "info"));
}

function deciderNote(id, approuve) {
  const n = NOTES_FRAIS.find((x) => x.id === id);
  if (connecte()) return deciderNoteApi(n, approuve);
  n.statut = approuve ? "approuvee" : "rejetee";
  NOTIFICATIONS.unshift({
    id: idNotif++, matricule: n.matricule,
    titre: approuve ? "Note de frais approuvée" : "Note de frais refusée",
    message: `${n.reference} · ${dinars(n.total)}${approuve ? " — mise en paiement" : ""}`,
    type: approuve ? "succes" : "alerte", lien: "/notes-de-frais", lu: false, date: new Date(),
  });
  toast(approuve ? "Note approuvée" : "Note refusée", `${n.reference} · ${nomComplet(parMatricule[n.matricule])} a été notifié.`, approuve ? "succes" : "info");
  rendre(false);
}

/* ==========================================================================
   25. ENTRETIENS & OBJECTIFS
   ========================================================================== */
const STATUTS_ENTRETIEN = {
  a_planifier: ["attente", "À planifier"], planifie: ["info", "Planifié"], realise: ["approuvee", "Réalisé"],
};

VUES["/entretiens"] = function () {
  const f = etat.filtres.entretiens || (etat.filtres.entretiens = { onglet: "mien" });
  const mien = ENTRETIENS.find((x) => x.matricule === moi().matricule);
  const equipe = estValideur()
    ? ENTRETIENS.filter((x) => x.evaluateur === moi().matricule || (estAdmin() && x.matricule !== moi().matricule))
    : [];

  if (f.onglet === "equipe" && estValideur()) return vueEntretiensEquipe(equipe, f);

  const avancementGlobal = Math.round(mien.objectifs.reduce((s, o) => s + o.avancement * o.poids, 0)
    / mien.objectifs.reduce((s, o) => s + o.poids, 0));
  const [cls, libelleStatut] = STATUTS_ENTRETIEN[mien.statut];
  const evaluateur = mien.evaluateur ? parMatricule[mien.evaluateur] : null;

  return `
  ${estValideur() ? `<div class="segment" id="entretiens-onglets" style="align-self:flex-start">
    <button data-onglet="mien" class="${f.onglet === "mien" ? "actif" : ""}">Mon entretien</button>
    <button data-onglet="equipe" class="${f.onglet === "equipe" ? "actif" : ""}">Mon équipe (${equipe.length})</button>
  </div>` : ""}

  <section class="carte" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
    <div class="kpi-ico" style="background:var(--marine-doux);color:var(--marine);width:46px;height:46px;border-radius:14px">${ico("signature")}</div>
    <div style="flex:1;min-width:230px">
      <h2>${echapper(mien.campagne)}</h2>
      <p style="font-size:12.5px;color:var(--encre-3);margin-top:3px">
        ${evaluateur ? `Conduit par ${echapper(nomComplet(evaluateur))}` : "Conduit par la direction"} ·
        ${mien.statut === "realise" ? `réalisé le ${fmtDate(mien.date)}` : `prévu le ${fmtDate(mien.date)}`}
      </p>
    </div>
    <span class="badge ${cls}">${libelleStatut}</span>
    <div style="min-width:186px">
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--encre-3);margin-bottom:5px">
        <span>Avancement pondéré</span><strong style="color:var(--encre)">${avancementGlobal} %</strong>
      </div>
      <div class="jauge"><span style="width:${avancementGlobal}%"></span></div>
    </div>
  </section>

  <section class="carte">
    <div class="carte-entete"><h3>Mes objectifs ${ANNEE}</h3><span class="carte-sous">Ajustez l'avancement, votre responsable le voit en temps réel</span></div>
    <div style="display:flex;flex-direction:column;gap:14px">
      ${mien.objectifs.map((o, i) => `
        <div style="padding:14px;border:1px solid var(--trait);border-radius:var(--r-m)">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px">
            <div style="min-width:220px;flex:1">
              <strong style="font-size:13.5px;display:block">${echapper(o.titre)}</strong>
              <p style="font-size:12.5px;color:var(--encre-2);margin-top:3px">${echapper(o.description)}</p>
            </div>
            <span class="badge neutre">Poids ${o.poids} %</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <input type="range" min="0" max="100" step="5" value="${o.avancement}" data-objectif="${i}" style="flex:1;accent-color:var(--marine)">
            <strong class="num" id="valeur-objectif-${i}" style="min-width:48px;text-align:right;font-family:var(--police-titre);font-size:16px">${o.avancement} %</strong>
          </div>
        </div>`).join("")}
    </div>
  </section>

  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <article class="carte">
      <div class="carte-entete"><h3>Mes souhaits d'évolution</h3></div>
      <textarea class="saisie" id="entretien-souhaits" style="min-height:104px">${echapper(mien.souhaits)}</textarea>
      <button class="btn primaire petit" id="entretien-enregistrer" style="margin-top:11px">${ico("check")} Enregistrer</button>
    </article>
    <article class="carte">
      <div class="carte-entete"><h3>Retour de votre responsable</h3></div>
      ${mien.commentaireManager
        ? `<p style="font-size:13px;color:var(--encre-2);line-height:1.6">${echapper(mien.commentaireManager)}</p>`
        : etatVide("users", "Pas encore de retour", "Le compte rendu sera visible ici après l'entretien.")}
    </article>
  </section>`;
};

function vueEntretiensEquipe(equipe, f) {
  return `
  <div class="segment" id="entretiens-onglets" style="align-self:flex-start">
    <button data-onglet="mien" class="${f.onglet === "mien" ? "actif" : ""}">Mon entretien</button>
    <button data-onglet="equipe" class="${f.onglet === "equipe" ? "actif" : ""}">Mon équipe (${equipe.length})</button>
  </div>

  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
    ${carteKpi({ cle: "en1", libelle: "Entretiens réalisés", valeur: equipe.filter((x) => x.statut === "realise").length, unite: `/ ${equipe.length}`, icone: "check", couleur: "var(--succes)", fond: "var(--succes-doux)", detail: `Campagne ${ANNEE}` })}
    ${carteKpi({ cle: "en2", libelle: "À planifier", valeur: equipe.filter((x) => x.statut === "a_planifier").length, unite: "", icone: "calendrier", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: "Date non fixée" })}
    ${carteKpi({ cle: "en3", libelle: "Avancement moyen des objectifs", valeur: Math.round(equipe.reduce((s, x) => s + x.objectifs.reduce((t, o) => t + o.avancement, 0) / x.objectifs.length, 0) / (equipe.length || 1)), unite: "%", icone: "tableau", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: "Toutes personnes confondues" })}
  </section>

  <section class="carte">
    <div class="carte-entete"><h2>Entretiens de mon équipe</h2></div>
    <div class="tableau-boite">
      <table style="min-width:680px">
        <thead><tr><th>Collaborateur</th><th>Date</th><th class="centre">Objectifs</th><th style="width:210px">Avancement</th><th>Statut</th><th class="droite">Action</th></tr></thead>
        <tbody>
          ${equipe.map((x) => {
            const e = parMatricule[x.matricule];
            const moyenne = Math.round(x.objectifs.reduce((s, o) => s + o.avancement, 0) / x.objectifs.length);
            const [cls, libelle] = STATUTS_ENTRETIEN[x.statut];
            return `<tr>
              <td><div style="display:flex;align-items:center;gap:9px">
                <div class="avatar s" style="background:${couleurDept(e.dept)}">${initiales(e)}</div>
                <div><strong style="font-size:13px">${echapper(nomComplet(e))}</strong>
                <div style="font-size:11.5px;color:var(--encre-3)">${echapper(e.poste)}</div></div>
              </div></td>
              <td class="mono">${fmtDate(x.date)}</td>
              <td class="centre num">${x.objectifs.length}</td>
              <td><div class="jauge"><span style="width:${moyenne}%"></span></div>
                  <span style="font-size:11.5px;color:var(--encre-3)">${moyenne} %</span></td>
              <td><span class="badge ${cls}">${libelle}</span></td>
              <td class="droite"><button class="btn petit" data-entretien="${x.matricule}">${ico("crayon")} Compte rendu</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </section>`;
}

BRANCHEMENTS["/entretiens"] = function () {
  const f = etat.filtres.entretiens;
  $$("#entretiens-onglets button").forEach((b) => b.addEventListener("click", () => { f.onglet = b.dataset.onglet; rendre(false); }));

  const mien = ENTRETIENS.find((x) => x.matricule === moi().matricule);
  $$("[data-objectif]").forEach((curseur) => {
    curseur.addEventListener("input", () => {
      const index = Number(curseur.dataset.objectif);
      mien.objectifs[index].avancement = Number(curseur.value);
      $(`#valeur-objectif-${index}`).textContent = `${curseur.value} %`;
    });
  });
  const enregistrer = $("#entretien-enregistrer");
  if (enregistrer) enregistrer.addEventListener("click", () => {
    mien.souhaits = $("#entretien-souhaits").value.trim();
    toast("Entretien mis à jour", "Vos objectifs et souhaits sont visibles par votre responsable.", "succes");
    rendre(false);
  });
  $$("[data-entretien]").forEach((b) => b.addEventListener("click", () => ouvrirCompteRendu(b.dataset.entretien)));
};

function ouvrirCompteRendu(matricule) {
  const entretien = ENTRETIENS.find((x) => x.matricule === matricule);
  const e = parMatricule[matricule];
  ouvrirCouche(`
    <div class="modale" role="dialog" aria-modal="true">
      <div class="modale-tete">
        <div><h2>Compte rendu d'entretien</h2><div class="sous">${echapper(nomComplet(e))} · ${echapper(entretien.campagne)}</div></div>
      </div>
      <div class="modale-corps">
        <div class="ligne-champs">
          <div class="champ"><label for="cr-date">Date de l'entretien</label><input class="saisie" type="date" id="cr-date" value="${entretien.date}"></div>
          <div class="champ"><label for="cr-statut">Statut</label>
            <select class="saisie" id="cr-statut">
              ${Object.entries(STATUTS_ENTRETIEN).map(([cle, [, libelle]]) => `<option value="${cle}" ${entretien.statut === cle ? "selected" : ""}>${libelle}</option>`).join("")}
            </select></div>
        </div>
        <div class="champ">
          <label for="cr-commentaire">Appréciation générale</label>
          <textarea class="saisie" id="cr-commentaire" placeholder="Points forts, axes de progrès, moyens à mettre en œuvre…">${echapper(entretien.commentaireManager || "")}</textarea>
        </div>
        <div style="font-size:12.5px;color:var(--encre-2)">
          <strong>Souhaits exprimés :</strong> ${echapper(entretien.souhaits)}
        </div>
      </div>
      <div class="modale-pied">
        <button class="btn" id="cr-annuler">Annuler</button>
        <button class="btn primaire" id="cr-valider">${ico("check")} Enregistrer</button>
      </div>
    </div>`);
  $("#cr-annuler").addEventListener("click", fermerCouche);
  $("#cr-valider").addEventListener("click", () => {
    entretien.date = $("#cr-date").value;
    entretien.statut = $("#cr-statut").value;
    entretien.commentaireManager = $("#cr-commentaire").value.trim() || null;
    NOTIFICATIONS.unshift({ id: idNotif++, matricule, titre: "Entretien annuel mis à jour",
      message: `${nomComplet(moi())} a complété votre compte rendu d'entretien.`, type: "info", lien: "/entretiens", lu: false, date: new Date() });
    fermerCouche();
    toast("Compte rendu enregistré", `${nomComplet(e)} a été notifié.`, "succes");
    rendre(false);
  });
}
