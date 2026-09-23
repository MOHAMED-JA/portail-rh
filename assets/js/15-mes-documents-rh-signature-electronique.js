/* ==========================================================================
   15. MES DOCUMENTS RH + signature électronique
   ========================================================================== */
const CATEGORIES_DOC = {
  bulletin: ["Bulletins de paie", "doc", "var(--marine)", "var(--marine-doux)"],
  attestation: ["Attestations", "bouclier", "var(--succes)", "var(--succes-doux)"],
  contrat: ["Contrats & avenants", "signature", "var(--violet)", "var(--violet-doux)"],
};

VUES["/documents"] = function () {
  const docs = DOCUMENTS.filter((d) => d.matricule === moi().matricule);
  const aSigner = docs.filter((d) => d.signable && !d.signe);

  return `
  ${aSigner.length ? `<section class="carte" style="border-color:var(--rouge);background:var(--rouge-doux)">
    <div style="display:flex;gap:13px;align-items:center;flex-wrap:wrap">
      <div class="kpi-ico" style="background:rgba(255,255,255,.55);color:var(--rouge);width:42px;height:42px;border-radius:13px">${ico("signature")}</div>
      <div style="flex:1;min-width:210px">
        <h3>${aSigner.length} document(s) à signer</h3>
        <p style="font-size:12.5px;color:var(--encre-2);margin-top:2px">${aSigner.map((d) => echapper(d.titre)).join(" · ")}</p>
      </div>
      <button class="btn primaire" data-signer="${aSigner[0].id}">${ico("signature")} Signer maintenant</button>
    </div>
  </section>` : ""}

  <section class="grille" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    ${Object.entries(CATEGORIES_DOC).map(([cle, [titre, icone, couleur, fond]]) => {
      const liste = docs.filter((d) => d.categorie === cle).sort((a, b) => b.date - a.date);
      return `<article class="carte">
        <div class="carte-entete">
          <div class="kpi-ico" style="background:${fond};color:${couleur}">${ico(icone)}</div>
          <h3>${titre}</h3>
          <span class="badge neutre">${liste.length}</span>
        </div>
        ${liste.length ? `<div style="display:flex;flex-direction:column;gap:7px">
          ${liste.map((d) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 11px;border:1px solid var(--trait);border-radius:var(--r-m)">
            <div style="min-width:0;flex:1">
              <strong style="font-size:13px;display:block">${echapper(d.titre)}</strong>
              <span style="font-size:11.5px;color:var(--encre-3)">${d.periode || ""} · ajouté ${tempsRelatif(d.date)}</span>
            </div>
            ${d.signe ? `<span class="badge approuvee">${ico("check")} Signé</span>`
              : d.signable ? `<button class="btn petit" data-signer="${d.id}">${ico("signature")} Signer</button>` : ""}
            <button class="btn petit icone fantome" data-doc="${d.id}" aria-label="Télécharger">${ico("telecharger")}</button>
          </div>`).join("")}
        </div>` : etatVide("doc", "Rien pour l'instant", "Les documents déposés par la RH apparaîtront ici.")}
      </article>`;
    }).join("")}
  </section>`;
};

function ouvrirSignature(id) {
  const doc = DOCUMENTS.find((d) => d.id === Number(id));
  if (!doc) return;
  ouvrirCouche(`
    <div class="modale" role="dialog" aria-modal="true">
      <div class="modale-tete">
        <div><h2>Signature électronique</h2><div class="sous">${echapper(doc.titre)} · ${echapper(nomComplet(moi()))}</div></div>
      </div>
      <div class="modale-corps">
        <p style="font-size:13px;color:var(--encre-2)">Tracez votre signature dans le cadre ci-dessous. Elle sera horodatée et attachée au document dans le journal d'audit.</p>
        <canvas class="pave-signature" id="pave"></canvas>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <button class="btn petit fantome" id="effacer-signature">${ico("croix")} Effacer</button>
          <span style="font-size:11.5px;color:var(--encre-3)">${fmtDateLongue(AUJOURDHUI)} · ${moi().matricule}</span>
        </div>
      </div>
      <div class="modale-pied">
        <button class="btn" id="annuler-signature">Annuler</button>
        <button class="btn primaire" id="valider-signature">${ico("check")} Signer le document</button>
      </div>
    </div>`);

  const canvas = $("#pave");
  const ctx = canvas.getContext("2d");
  const redimensionner = () => {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = couleurCss("--encre");
  };
  redimensionner();

  let dessine = false, vide = true;
  const position = (e) => {
    const r = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return [point.clientX - r.left, point.clientY - r.top];
  };
  const debuter = (e) => { e.preventDefault(); dessine = true; vide = false; ctx.beginPath(); ctx.moveTo(...position(e)); };
  const tracer = (e) => { if (!dessine) return; e.preventDefault(); ctx.lineTo(...position(e)); ctx.stroke(); };
  const finir = () => { dessine = false; };
  ["mousedown", "touchstart"].forEach((ev) => canvas.addEventListener(ev, debuter));
  ["mousemove", "touchmove"].forEach((ev) => canvas.addEventListener(ev, tracer));
  ["mouseup", "mouseleave", "touchend"].forEach((ev) => canvas.addEventListener(ev, finir));

  $("#effacer-signature").addEventListener("click", () => { ctx.clearRect(0, 0, canvas.width, canvas.height); vide = true; });
  $("#annuler-signature").addEventListener("click", fermerCouche);
  $("#valider-signature").addEventListener("click", () => {
    if (vide) return toast("Signature manquante", "Tracez votre signature avant de valider.", "danger");
    doc.signe = true;
    doc.signature = canvas.toDataURL("image/png");
    JOURNAL.unshift({ action: "Signature électronique", cible: doc.titre, acteur: moi().matricule, detail: `Signé par ${nomComplet(moi())}`, date: new Date() });
    fermerCouche();
    toast("Document signé", `${doc.titre} — signature horodatée et archivée.`, "succes");
    rendre(false);
  });
}

/* ==========================================================================
   16. ADMINISTRATION RH
   ========================================================================== */
VUES["/administration"] = function () {
  const f = etat.filtres.admin || (etat.filtres.admin = { onglet: "employes", recherche: "", dept: "" });
  const onglets = [["employes", "Employés"], ["departements", "Départements"], ["synthese", "Synthèse"], ["organigramme", "Organigramme"], ["journal", "Journal d'audit"], ["import", "Import & exports"]];

  let corps = "";
  if (f.onglet === "employes") corps = adminEmployes(f);
  else if (f.onglet === "departements") corps = adminDepartements();
  else if (f.onglet === "synthese") corps = adminSynthese();
  else if (f.onglet === "organigramme") corps = adminOrganigramme();
  else if (f.onglet === "journal") corps = adminJournal();
  else corps = adminImport();

  return `<section class="carte">
    <div class="carte-entete" style="flex-wrap:wrap;gap:10px">
      <div class="segment" id="onglets-admin">
        ${onglets.map(([cle, libelle]) => `<button data-onglet="${cle}" class="${f.onglet === cle ? "actif" : ""}">${libelle}</button>`).join("")}
      </div>
    </div>
    ${corps}
  </section>`;
};

function adminEmployes(f) {
  let liste = EMPLOYES;
  if (f.recherche) {
    const q = f.recherche.toLowerCase();
    liste = liste.filter((e) => nomComplet(e).toLowerCase().includes(q) || e.matricule.toLowerCase().includes(q) || e.poste.toLowerCase().includes(q));
  }
  if (f.dept) liste = liste.filter((e) => e.dept === f.dept);

  return `
    <div class="barre-filtres" style="margin-bottom:14px">
      <input class="saisie" id="admin-recherche" placeholder="Rechercher un collaborateur…" value="${echapper(f.recherche)}" style="min-width:230px">
      <select class="saisie" id="admin-dept">
        <option value="">Tous les départements</option>
        ${DEPARTEMENTS.map((d) => `<option value="${d.code}" ${f.dept === d.code ? "selected" : ""}>${d.nom}</option>`).join("")}
      </select>
      <span class="compteur-resultats">${liste.length} collaborateur(s)</span>
      <button class="btn primaire petit" id="nouvel-employe">${ico("plus")} Créer un profil</button>
    </div>

    ${liste.length ? `<div class="tableau-boite">
      <table style="min-width:900px">
        <thead><tr>
          <th>Collaborateur</th><th>Matricule</th><th>Département</th><th>Supérieur hiérarchique</th>
          <th class="centre">Solde ${ANNEE}</th><th>Rôle</th><th class="droite">Actions</th>
        </tr></thead>
        <tbody>
          ${liste.map((e) => {
            const solde = soldeDe(e.matricule);
            const roles = { employe: ["neutre", "Utilisateur"], validateur: ["info", "Supérieur"], admin: ["violet", "Admin RH"] }[e.role];
            return `<tr>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  <div class="avatar s" style="background:${couleurDept(e.dept)}">${initiales(e)}</div>
                  <div><strong style="font-size:13px">${echapper(nomComplet(e))}</strong>
                  <div style="font-size:11.5px;color:var(--encre-3)">${echapper(e.poste)}</div></div>
                </div>
              </td>
              <td class="mono" style="font-size:12px">${e.matricule}</td>
              <td><span class="puce-type"><span class="point" style="background:${couleurDept(e.dept)}"></span>${nomDept(e.dept)}</span></td>
              <td>${e.validateur ? echapper(nomComplet(parMatricule[e.validateur])) : "—"}</td>
              <td class="centre num"><strong>${fmtNombre(solde.restant)}</strong> <span style="color:var(--encre-3)">/ ${fmtNombre(solde.total)} j</span></td>
              <td><span class="badge ${roles[0]}">${roles[1]}</span></td>
              <td class="droite" style="white-space:nowrap">
                <button class="btn petit icone fantome" data-solde="${e.matricule}" title="Ajuster le solde">${ico("calendrier")}</button>
                <button class="btn petit icone fantome" data-editer="${e.matricule}" title="Modifier">${ico("crayon")}</button>
                ${e.matricule !== moi().matricule && !estGestionnaire() ? `<button class="btn petit icone fantome" data-supprimer-profil="${e.matricule}" title="Supprimer le profil (sortie des effectifs)" style="color:var(--danger)">${ico("poubelle")}</button>` : ""}
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>` : etatVide("users", "Aucun collaborateur trouvé", "Ajustez votre recherche ou changez de département.")}`;
}

function adminDepartements() {
  return `<div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(252px,1fr))">
    ${DEPARTEMENTS.map((d) => {
      const membres = EMPLOYES.filter((e) => e.dept === d.code);
      const responsable = membres.find((e) => e.role === "validateur" || e.role === "admin");
      const enAttente = DEMANDES.filter((x) => x.statut === "en_attente" && membres.some((m) => m.matricule === x.matricule)).length;
      return `<article class="carte" style="border-top:3px solid ${d.couleur}">
        <div class="carte-entete">
          <h3>${d.nom}</h3>
          <span class="badge neutre mono">${d.code}</span>
        </div>
        <div style="display:flex;gap:18px;margin-bottom:12px">
          <div><div style="font-family:var(--police-titre);font-size:22px;font-weight:700">${membres.length}</div>
          <div style="font-size:11.5px;color:var(--encre-3)">collaborateurs</div></div>
          <div><div style="font-family:var(--police-titre);font-size:22px;font-weight:700;color:${enAttente ? "var(--alerte)" : "inherit"}">${enAttente}</div>
          <div style="font-size:11.5px;color:var(--encre-3)">demandes en attente</div></div>
        </div>
        ${responsable ? `<div style="display:flex;align-items:center;gap:9px;padding-top:12px;border-top:1px solid var(--trait)">
          <div class="avatar s" style="background:${d.couleur}">${initiales(responsable)}</div>
          <div><strong style="font-size:12.5px;display:block">${echapper(nomComplet(responsable))}</strong>
          <span style="font-size:11.5px;color:var(--encre-3)">Responsable</span></div>
        </div>` : ""}
        <div style="display:flex;margin-top:12px;gap:-6px">
          ${membres.slice(0, 7).map((m, i) => `<div class="avatar s" style="background:${couleurDept(m.dept)};margin-left:${i ? "-8px" : "0"};border:2px solid var(--surface)" title="${echapper(nomComplet(m))}">${initiales(m)}</div>`).join("")}
          ${membres.length > 7 ? `<div class="avatar s" style="background:var(--surface-3);color:var(--encre-2);margin-left:-8px;border:2px solid var(--surface)">+${membres.length - 7}</div>` : ""}
        </div>
      </article>`;
    }).join("")}
  </div>`;
}

function adminSynthese() {
  const lignes = DEPARTEMENTS.map((d) => {
    const membres = EMPLOYES.filter((e) => e.dept === d.code).map((e) => e.matricule);
    const pointages = POINTAGES.filter((p) => membres.includes(p.matricule));
    const total = pointages.length || 1;
    const absences = pointages.filter((p) => p.code === "absent").length;
    const conges = pointages.filter((p) => p.code === "conge").length;
    const retards = pointages.filter((p) => p.retard > 0);
    return {
      dept: d, effectif: membres.length,
      absenteisme: Math.round(((absences + conges) / total) * 1000) / 10,
      retardMoyen: retards.length ? Math.round(retards.reduce((s, p) => s + p.retard, 0) / retards.length) : 0,
      anomalies: ANOMALIES.filter((a) => a.statut === "ouverte" && membres.includes(a.matricule)).length,
      enAttente: DEMANDES.filter((x) => x.statut === "en_attente" && membres.includes(x.matricule)).length,
      heures: Math.round(pointages.reduce((s, p) => s + p.heures, 0)),
    };
  });
  etat.syntheseLignes = lignes;

  return `
    <div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:16px">
      ${carteKpi({ cle: "a1", libelle: "Effectif total", valeur: EMPLOYES.length, unite: "", icone: "users", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: `${DEPARTEMENTS.length} départements` })}
      ${carteKpi({ cle: "a2", libelle: "Taux d'absentéisme", valeur: fmtNombre(lignes.reduce((s, l) => s + l.absenteisme, 0) / lignes.length), unite: "%", icone: "alerte", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: `Moyenne entreprise ${ANNEE}` })}
      ${carteKpi({ cle: "a3", libelle: "Demandes en attente", valeur: DEMANDES.filter((d) => d.statut === "en_attente").length, unite: "", icone: "inbox", couleur: "var(--violet)", fond: "var(--violet-doux)", detail: "Toutes équipes confondues" })}
      ${carteKpi({ cle: "a4", libelle: "Anomalies ouvertes", valeur: ANOMALIES.filter((a) => a.statut === "ouverte").length, unite: "", icone: "horloge", couleur: "var(--danger)", fond: "var(--danger-doux)", detail: "Pointages à régulariser" })}
    </div>

    <div class="carte" style="box-shadow:none;margin-bottom:16px">
      <div class="carte-entete"><h3>Absentéisme et ponctualité par département</h3><span class="carte-sous">${ANNEE}</span></div>
      <div class="boite-graph"><canvas id="g-synthese"></canvas></div>
    </div>

    <div class="tableau-boite">
      <table style="min-width:760px">
        <thead><tr>
          <th>Département</th><th class="centre">Effectif</th><th class="centre">Absentéisme</th>
          <th class="centre">Retard moyen</th><th class="centre">Anomalies</th><th class="centre">En attente</th><th class="centre">Heures ${ANNEE}</th>
        </tr></thead>
        <tbody>
          ${lignes.map((l) => `<tr>
            <td><span class="puce-type"><span class="point" style="background:${l.dept.couleur}"></span>${l.dept.nom}</span></td>
            <td class="centre num">${l.effectif}</td>
            <td class="centre num" style="color:${l.absenteisme > 8 ? "var(--danger)" : "inherit"}">${fmtNombre(l.absenteisme)} %</td>
            <td class="centre num">${l.retardMoyen} min</td>
            <td class="centre num">${l.anomalies}</td>
            <td class="centre num">${l.enAttente}</td>
            <td class="centre num">${l.heures.toLocaleString("fr-FR")} h</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function adminOrganigramme() {
  const construire = (employe) => {
    const enfants = EMPLOYES.filter((e) => e.validateur === employe.matricule);
    return `<div class="organi-branche">
      <div class="organi-carte" style="border-top-color:${couleurDept(employe.dept)}" data-fiche="${employe.matricule}">
        <div class="avatar s" style="background:${couleurDept(employe.dept)}">${initiales(employe)}</div>
        <div><strong>${echapper(nomComplet(employe))}</strong><span>${echapper(employe.poste)}</span></div>
      </div>
      ${enfants.length ? `<div class="organi-enfants">${enfants.map(construire).join("")}</div>` : ""}
    </div>`;
  };
  const racines = EMPLOYES.filter((e) => !e.validateur);
  return `<div class="organi">${racines.map(construire).join("")}</div>
    <p style="font-size:12px;color:var(--encre-3);margin-top:10px">${ico("users")} ${EMPLOYES.length} collaborateurs · la hiérarchie détermine automatiquement le circuit de validation des demandes.</p>`;
}

function adminJournal() {
  return `<div class="inbox">
    ${JOURNAL.length ? "" : etatVide("doc", "Journal vide", "Les actions administratives apparaîtront ici.")}
    ${JOURNAL.map((j) => {
      const acteur = parMatricule[j.acteur] || { prenom: j.acteurNom || "Système", nom: "", dept: null, matricule: j.acteur || "" };
      return `<article class="inbox-item conge">
        <div class="avatar s" style="background:${couleurDept(acteur.dept)}">${initiales(acteur)}</div>
        <div class="inbox-corps">
          <div class="titre">${echapper(j.action)} <span class="badge neutre mono">${echapper(j.cible || "")}</span></div>
          <div class="detail">${echapper(j.detail || "")}</div>
          <div class="meta"><span>${echapper(nomComplet(acteur))}</span><span>${fmtDateLongue(j.date)}</span></div>
        </div>
        <span class="badge neutre">${tempsRelatif(j.date)}</span>
      </article>`;
    }).join("")}
  </div>`;
}

function adminImport() {
  return `<div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <article class="carte" style="box-shadow:none">
      <div class="carte-entete">
        <div class="kpi-ico" style="background:var(--marine-doux);color:var(--marine)">${ico("import")}</div>
        <h3>Import de pointages</h3>
      </div>
      <p style="font-size:13px;color:var(--encre-2);margin-bottom:12px">
        Déposez l'export de la pointeuse. Colonnes attendues :
        <span class="mono" style="font-size:11.5px">matricule ; date ; entree1 ; sortie1 ; entree2 ; sortie2 ; code</span>.
        Les anomalies sont recalculées automatiquement après import.
      </p>
      <div class="champ">
        <label for="fichier-import">Fichier CSV ou Excel</label>
        <input class="saisie" type="file" id="fichier-import" accept=".csv,.xlsx,.xls" data-formats-donnees>
      </div>
      <button class="btn primaire btn-bloc" id="lancer-import" style="margin-top:12px">${ico("import")} Lancer l'import</button>
    </article>

    <article class="carte" style="box-shadow:none">
      <div class="carte-entete">
        <div class="kpi-ico" style="background:var(--succes-doux);color:var(--succes)">${ico("telecharger")}</div>
        <h3>Exports</h3>
      </div>
      <p style="font-size:13px;color:var(--encre-2);margin-bottom:12px">Documents générés aux couleurs de la marque Assurance, prêts à transmettre à la direction ou à la paie.</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-bloc" data-export="Registre des demandes (Excel)">${ico("telecharger")} Registre des demandes — Excel</button>
        <button class="btn btn-bloc" data-export="Pointages du mois (Excel)">${ico("telecharger")} Pointages du mois — Excel</button>
        <button class="btn btn-bloc" data-export="Synthèse RH (PDF)">${ico("telecharger")} Synthèse RH consolidée — PDF</button>
        <button class="btn btn-bloc" data-export="Attestations de solde (PDF)">${ico("telecharger")} Attestations de solde — PDF</button>
      </div>
    </article>
  </div>`;
}

function graphiqueSynthese() {
  const lignes = etat.syntheseLignes || [];
  const h = habillage();
  const g = new Chart($("#g-synthese"), {
    data: {
      labels: lignes.map((l) => l.dept.code),
      datasets: [
        { type: "bar", label: "Taux d'absentéisme (%)", data: lignes.map((l) => l.absenteisme),
          backgroundColor: lignes.map((l) => l.dept.couleur), borderRadius: 6, maxBarThickness: 40, yAxisID: "y" },
        { type: "line", label: "Retard moyen (min)", data: lignes.map((l) => l.retardMoyen),
          borderColor: h.rouge, backgroundColor: h.rouge, borderWidth: 2.4, tension: .35, pointRadius: 4,
          pointBackgroundColor: h.surface, pointBorderWidth: 2, yAxisID: "y1" },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, border: { color: h.trait }, ticks: { color: h.encre3, font: { family: "IBM Plex Mono", size: 11.5 } } },
        y: { position: "left", beginAtZero: true, grid: { color: h.trait }, border: { display: false },
          ticks: { color: h.encre3, callback: (v) => `${v} %`, maxTicksLimit: 6, font: { size: 11 } } },
        y1: { position: "right", beginAtZero: true, grid: { display: false }, border: { display: false },
          ticks: { color: h.rouge, callback: (v) => `${v} min`, maxTicksLimit: 5, font: { size: 11 } } },
      },
      plugins: {
        legend: { position: "top", align: "end", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle", color: h.encre, padding: 16, font: { family: "IBM Plex Sans", size: 12 } } },
        tooltip: { ...infobulle(h), callbacks: { title: (items) => nomDept(items[0].label) } },
      },
    },
  });
  etat.graphiques.push(g);
}

function ouvrirFicheEmploye(matricule) {
  if (!estAdmin()) return toast("Action réservée", "Seul l'administrateur RH peut créer ou modifier un profil.", "danger");
  const e = matricule ? parMatricule[matricule] : null;
  if (e && estGestionnaire() && e.role === "admin") return toast("Compte RH", "Seul l'administrateur RH modifie un compte RH.", "alerte");
  const titre = e ? "Modifier le profil" : "Créer un profil";
  ouvrirCouche(`
    <aside class="tiroir" role="dialog" aria-modal="true">
      ${enteteTiroir(titre, e ? `${e.matricule} · ${nomDept(e.dept)}` : "Création d'un compte et de son solde initial")}
      <form class="tiroir-corps" id="form-employe">
        <div class="ligne-champs">
          <div class="champ"><label for="e-prenom">Prénom</label><input class="saisie" id="e-prenom" value="${e ? echapper(e.prenom) : ""}"></div>
          <div class="champ"><label for="e-nom">Nom</label><input class="saisie" id="e-nom" value="${e ? echapper(e.nom) : ""}"></div>
        </div>
        <div class="ligne-champs">
          <div class="champ"><label for="e-matricule">Matricule</label><input class="saisie mono" id="e-matricule" value="${e ? e.matricule : "VT" + String(EMPLOYES.length + 62).padStart(4, "0")}" ${e ? "readonly" : ""}></div>
          <div class="champ"><label for="e-entree">Date d'entrée</label><input class="saisie" type="date" id="e-entree" value="${e ? (e.entree || "") : iso(AUJOURDHUI)}"></div>
        </div>
        <div class="champ"><label for="e-poste">Poste</label><input class="saisie" id="e-poste" value="${e ? echapper(e.poste) : ""}"></div>
        <div class="champ"><label for="e-email">Email professionnel</label><input class="saisie" type="email" id="e-email" value="${e ? e.email : ""}"></div>
        <div class="ligne-champs">
          <div class="champ"><label for="e-dept">Département</label>
            <select class="saisie" id="e-dept">${DEPARTEMENTS.map((d) => `<option value="${d.code}" ${e && e.dept === d.code ? "selected" : ""}>${d.nom}</option>`).join("")}</select>
          </div>
          <div class="champ"><label for="e-role">Profil</label>
            <select class="saisie" id="e-role">
              ${optionsRoles().map(([v, l]) => `<option value="${v}" ${roleFormulaire(e) === v ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="champ"><label for="e-niveau">Niveau hiérarchique</label>
          <select class="saisie" id="e-niveau">
            ${NIVEAUX_HIERARCHIQUES.map(([v, l]) => `<option value="${v}" ${(e ? e.niveau || "collaborateur" : "collaborateur") === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
          <span class="aide">Directeur Général et Directeur Général Adjoint : consultation de toutes les informations non confidentielles du personnel.</span></div>
        <div class="champ"><label for="e-validateur">Supérieur hiérarchique (N+1)</label>
          <select class="saisie" id="e-validateur">
            <option value="">Aucun — relève directement de la RH</option>
            ${EMPLOYES.filter((x) => x.role !== "employe" && (!e || x.matricule !== e.matricule))
              .map((x) => `<option value="${x.matricule}" ${e && e.validateur === x.matricule ? "selected" : ""}>${nomComplet(x)} — ${x.poste}</option>`).join("")}
          </select>
        </div>
        ${e ? `<div class="champ"><label for="e-mdp-reset">Nouveau mot de passe</label>
          <input class="saisie" type="password" id="e-mdp-reset" autocomplete="new-password" placeholder="Laisser vide pour ne pas le changer">
          <span class="aide">Enregistré en base ; le collaborateur est notifié et pourra le changer depuis « Mon profil ».</span></div>` : `<div class="ligne-champs">
          <div class="champ"><label for="e-solde">Solde de congés initial (jours)</label><input class="saisie" type="number" id="e-solde" value="21" min="0" max="45"></div>
          <div class="champ"><label for="e-motdepasse">Mot de passe initial</label><input class="saisie" type="password" id="e-motdepasse" value="demo2026" autocomplete="new-password">
            <span class="aide">À communiquer au collaborateur, qui le changera depuis « Mon profil ».</span></div>
        </div>`}
      </form>
      <div class="tiroir-pied">
        <button class="btn" id="annuler-employe">Annuler</button>
        <button class="btn primaire" id="enregistrer-employe">${ico("check")} Enregistrer</button>
      </div>
    </aside>`, { tiroir: true });

  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#annuler-employe").addEventListener("click", fermerCouche);
  $("#enregistrer-employe").addEventListener("click", () => {
    const donnees = {
      prenom: $("#e-prenom").value.trim(), nom: $("#e-nom").value.trim(),
      matricule: $("#e-matricule").value.trim().toUpperCase(), poste: $("#e-poste").value.trim(),
      email: $("#e-email").value.trim(), dept: $("#e-dept").value, role: $("#e-role").value,
      validateur: $("#e-validateur").value || null, entree: $("#e-entree").value,
      niveau: $("#e-niveau") ? $("#e-niveau").value : "collaborateur",
    };
    if (!donnees.prenom || !donnees.nom || !donnees.poste) return toast("Champs manquants", "Prénom, nom et poste sont obligatoires.", "danger");

    if (typeof connecte === "function" && connecte()) {
      enregistrerEmployeConnecte(e, donnees, $("#e-solde") ? Number($("#e-solde").value) : null);
      return;
    }
    if (e) {
      const reinitialisation = $("#e-mdp-reset") ? $("#e-mdp-reset").value.trim() : "";
      if (reinitialisation) MOTS_DE_PASSE_DEMO[e.matricule] = reinitialisation;
      Object.assign(e, donnees);
      JOURNAL.unshift({ action: "Modification employé", cible: e.matricule, acteur: moi().matricule, detail: nomComplet(e), date: new Date() });
      toast("Collaborateur mis à jour", `${nomComplet(e)} — modifications enregistrées.`, "succes");
    } else {
      if (parMatricule[donnees.matricule]) return toast("Matricule déjà utilisé", "Choisissez un matricule unique.", "danger");
      const nouveau = { ...donnees, statut: "actif", telephone: "" };
      EMPLOYES.push(nouveau);
      parMatricule[nouveau.matricule] = nouveau;
      SOLDES[nouveau.matricule] = { annee: ANNEE, acquis: Number($("#e-solde").value) || 21, report: 0, pris: 0 };
      JOURNAL.unshift({ action: "Création employé", cible: nouveau.matricule, acteur: moi().matricule, detail: `${nomComplet(nouveau)} — ${nomDept(nouveau.dept)}`, date: new Date() });
      toast("Collaborateur créé", `${nomComplet(nouveau)} · identifiants transmis par email.`, "succes");
    }
    fermerCouche();
    rendre(false);
  });
}

function ouvrirAjustementSolde(matricule) {
  const e = parMatricule[matricule];
  const s = soldeDe(matricule);
  ouvrirCouche(`
    <div class="modale" role="dialog" aria-modal="true">
      <div class="modale-tete">
        <div><h2>Ajuster le solde</h2><div class="sous">${echapper(nomComplet(e))} · exercice ${ANNEE}</div></div>
      </div>
      <div class="modale-corps">
        <div class="ligne-champs">
          <div class="champ"><label for="s-acquis">Jours acquis</label><input class="saisie" type="number" step="0.5" id="s-acquis" value="${s.acquis}"></div>
          <div class="champ"><label for="s-report">Report ${ANNEE - 1}</label><input class="saisie" type="number" step="0.5" id="s-report" value="${s.report}"></div>
        </div>
        <div class="champ"><label for="s-pris">Jours déjà pris</label><input class="saisie" type="number" step="0.5" id="s-pris" value="${s.pris}"></div>
        <div class="carte" style="background:var(--surface-2);padding:13px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12.5px;color:var(--encre-2)">Solde résultant</span>
            <strong style="font-family:var(--police-titre);font-size:22px" id="s-apercu">${fmtNombre(s.restant)} j</strong>
          </div>
        </div>
      </div>
      <div class="modale-pied">
        <button class="btn" id="annuler-solde">Annuler</button>
        <button class="btn primaire" id="enregistrer-solde">${ico("check")} Enregistrer</button>
      </div>
    </div>`);

  const recalculer = () => {
    const r = (Number($("#s-acquis").value) + Number($("#s-report").value) - Number($("#s-pris").value));
    $("#s-apercu").textContent = `${fmtNombre(r)} j`;
  };
  ["s-acquis", "s-report", "s-pris"].forEach((id) => $(`#${id}`).addEventListener("input", recalculer));
  $("#annuler-solde").addEventListener("click", fermerCouche);
  $("#enregistrer-solde").addEventListener("click", () => {
    if (typeof connecte === "function" && connecte()) {
      enregistrerSoldeConnecte(matricule, Number($("#s-acquis").value), Number($("#s-report").value), Number($("#s-pris").value));
      return;
    }
    SOLDES[matricule] = { annee: ANNEE, acquis: Number($("#s-acquis").value), report: Number($("#s-report").value), pris: Number($("#s-pris").value) };
    JOURNAL.unshift({ action: "Ajustement de solde", cible: matricule, acteur: moi().matricule, detail: `${fmtNombre(soldeDe(matricule).restant)} j restants`, date: new Date() });
    NOTIFICATIONS.unshift({ id: idNotif++, matricule, titre: "Solde de congés mis à jour",
      message: `Votre solde ${ANNEE} est désormais de ${fmtNombre(soldeDe(matricule).restant)} jour(s).`, type: "info", lien: "/mes-demandes", lu: false, date: new Date() });
    fermerCouche();
    toast("Solde mis à jour", `${nomComplet(e)} · ${fmtNombre(soldeDe(matricule).restant)} jour(s) restants.`, "succes");
    rendre(false);
  });
}

/* ==========================================================================
   17. NOTIFICATIONS & PALETTE DE COMMANDES
   ========================================================================== */
function ouvrirNotifications() {
  const liste = mesNotifications();
  ouvrirCouche(`
    <aside class="tiroir" role="dialog" aria-modal="true" aria-label="Notifications">
      ${enteteTiroir("Notifications", `${nonLues()} non lue(s) sur ${liste.length}`)}
      <div class="tiroir-corps">
        ${liste.length ? `<div style="display:flex;flex-direction:column">${liste.map(ligneNotification).join("")}</div>`
          : etatVide("cloche", "Aucune notification", "Les validations, refus et mises à jour de planning apparaîtront ici.")}
      </div>
      <div class="tiroir-pied">
        <button class="btn" id="fermer-notifs">Fermer</button>
        ${nonLues() ? `<button class="btn primaire" id="tout-lu-tiroir">${ico("check")} Tout marquer comme lu</button>` : ""}
      </div>
    </aside>`, { tiroir: true });

  $("#fermer-tiroir").addEventListener("click", fermerCouche);
  $("#fermer-notifs").addEventListener("click", fermerCouche);
  const btnTout = $("#tout-lu-tiroir");
  if (btnTout) btnTout.addEventListener("click", () => {
    mesNotifications().forEach((n) => { n.lu = true; });
    fermerCouche(); rendre(false);
    toast("Notifications lues", "Votre centre de notifications est à jour.", "succes");
  });
  $$("[data-notif]", $("#couche")).forEach((el) => el.addEventListener("click", () => {
    const n = NOTIFICATIONS.find((x) => x.id === Number(el.dataset.notif));
    if (n) { n.lu = true; fermerCouche(); if (n.lien) naviguer(n.lien); else rendre(false); }
  }));
}

function elementsPalette(recherche) {
  const q = recherche.trim().toLowerCase();
  const groupes = [];

  const nav = itemsNavigation()
    .filter((i) => !q || i.libelle.toLowerCase().includes(q))
    .map((i) => ({ icone: i.icone, titre: i.libelle, sous: `Aller à ${i.libelle.toLowerCase()}`, action: () => naviguer(i.route) }));
  if (nav.length) groupes.push(["Navigation", nav]);

  const actions = [
    { icone: "calendrier", titre: "Déposer une demande de congé", sous: "Nouvelle demande", action: () => ouvrirDemande("conge") },
    { icone: "horloge", titre: "Demander une autorisation d'absence", sous: "Nouvelle demande", action: () => ouvrirDemande("autorisation") },
    { icone: "avion", titre: "Créer un ordre de mission", sous: "Nouvelle demande", action: () => ouvrirDemande("mission") },
    { icone: themeActif() === "dark" ? "soleil" : "lune", titre: `Basculer en mode ${themeActif() === "dark" ? "clair" : "sombre"}`, sous: "Apparence", action: basculerTheme },
    { icone: "check", titre: "Badger maintenant", sous: "Présences", action: badger },
  ].filter((a) => !q || a.titre.toLowerCase().includes(q));
  if (actions.length) groupes.push(["Actions", actions]);

  if (q.length >= 2) {
    const demandes = mesDemandes().filter((d) => d.ref.toLowerCase().includes(q) || libelleType(d.type, d.sousType).toLowerCase().includes(q)).slice(0, 5)
      .map((d) => ({ icone: "demandes", titre: `${d.ref} — ${libelleType(d.type, d.sousType)}`, sous: `${fmtDate(d.debut)} → ${fmtDate(d.fin)}`, action: () => { naviguer("/mes-demandes"); setTimeout(() => ouvrirDetailDemande(d.ref), 120); } }));
    if (demandes.length) groupes.push(["Mes demandes", demandes]);

    if (estValideur()) {
      const gens = perimetre().filter((e) => nomComplet(e).toLowerCase().includes(q) || e.matricule.toLowerCase().includes(q)).slice(0, 6)
        .map((e) => ({ icone: "users", titre: nomComplet(e), sous: `${e.matricule} · ${e.poste}`, action: () => { etat.filtres.presences = { onglet: "pointages", employe: e.matricule, mois: AUJOURDHUI.getMonth() }; naviguer("/presences"); } }));
      if (gens.length) groupes.push(["Collaborateurs", gens]);
    }
  }
  return groupes;
}

function ouvrirPalette() {
  ouvrirCouche(`
    <div class="palette-voile" data-fermer="1" style="position:static;padding:0;background:none;backdrop-filter:none">
      <div class="palette" role="dialog" aria-modal="true" aria-label="Recherche globale">
        <div class="palette-saisie">
          ${ico("loupe")}<input id="palette-input" placeholder="Rechercher une page, une demande, un collaborateur…" autocomplete="off">
        </div>
        <div class="palette-liste" id="palette-liste"></div>
        <div class="palette-pied">
          <span><span class="raccourci">↑↓</span> naviguer</span>
          <span><span class="raccourci">⏎</span> ouvrir</span>
          <span><span class="raccourci">Échap</span> fermer</span>
        </div>
      </div>
    </div>`);

  let selection = 0, aplati = [];
  const dessiner = () => {
    const groupes = elementsPalette($("#palette-input").value);
    aplati = groupes.flatMap(([, items]) => items);
    selection = Math.min(selection, Math.max(0, aplati.length - 1));
    let index = -1;
    $("#palette-liste").innerHTML = groupes.length ? groupes.map(([titre, items]) => `
      <div class="palette-groupe">${titre}</div>
      ${items.map((item) => { index++; return `<button class="palette-item ${index === selection ? "actif" : ""}" data-index="${index}">
        ${ico(item.icone)}<div><strong>${echapper(item.titre)}</strong><span>${echapper(item.sous)}</span></div>
      </button>`; }).join("")}`).join("")
      : `<div class="vide" style="padding:28px"><p>Aucun résultat pour cette recherche.</p></div>`;

    $$("#palette-liste .palette-item").forEach((b) => b.addEventListener("click", () => lancer(Number(b.dataset.index))));
  };
  const lancer = (i) => { const item = aplati[i]; if (!item) return; fermerCouche(); item.action(); };

  $("#palette-input").addEventListener("input", () => { selection = 0; dessiner(); });
  $("#palette-input").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); selection = (selection + 1) % aplati.length; dessiner(); }
    if (e.key === "ArrowUp") { e.preventDefault(); selection = (selection - 1 + aplati.length) % aplati.length; dessiner(); }
    if (e.key === "Enter") { e.preventDefault(); lancer(selection); }
  });
  dessiner();
}

/* ==========================================================================
   18. BRANCHEMENTS PAR VUE
   ========================================================================== */
function brancherVueCourante() {
  // Éléments communs à plusieurs vues
  $$("[data-demande-ref]").forEach((el) => el.addEventListener("click", () => ouvrirDetailDemande(el.dataset.demandeRef)));
  $$("[data-demande]").forEach((el) => el.addEventListener("click", () => ouvrirDemande(el.dataset.demande)));
  $$("[data-notif]").forEach((el) => el.addEventListener("click", () => {
    const n = NOTIFICATIONS.find((x) => x.id === Number(el.dataset.notif));
    if (n) { n.lu = true; if (n.lien) naviguer(n.lien); else rendre(false); }
  }));
  const toutLu = $("[data-tout-lu]");
  if (toutLu) toutLu.addEventListener("click", () => {
    mesNotifications().forEach((n) => { n.lu = true; });
    rendre(false);
    toast("Notifications lues", "Votre centre de notifications est à jour.", "succes");
  });

  if (etat.route === "/tableau-bord") graphiquesTableauBord();

  if (etat.route === "/mes-demandes") {
    const f = etat.filtres.demandes;
    $$("#filtre-type button").forEach((b) => b.addEventListener("click", () => { f.type = b.dataset.valeur; rendre(false); }));
    $("#filtre-statut").addEventListener("change", (e) => { f.statut = e.target.value; rendre(false); });
    const recherche = $("#filtre-recherche");
    recherche.addEventListener("input", debounce((e) => {
      f.recherche = e.target.value; rendre(false);
      const champ = $("#filtre-recherche");
      champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length);
    }, 280));
  }

  if (etat.route === "/validation") {
    const f = etat.filtres.validation;
    $$("#filtre-type-validation button").forEach((b) => b.addEventListener("click", () => { f.type = b.dataset.valeur; rendre(false); }));
    const dept = $("#filtre-dept-validation");
    if (dept) dept.addEventListener("change", (e) => { f.dept = e.target.value; rendre(false); });
    $$("[data-approuver]").forEach((b) => b.addEventListener("click", () => decider(b.dataset.approuver, true)));
    $$("[data-rejeter]").forEach((b) => b.addEventListener("click", () => decider(b.dataset.rejeter, false)));
  }

  if (etat.route === "/presences") {
    const f = etat.filtres.presences;
    $$("#onglets-presences button").forEach((b) => b.addEventListener("click", () => { f.onglet = b.dataset.onglet; rendre(false); }));
    const employe = $("#filtre-employe");
    if (employe) {
      const choisir = () => {
        const q = employe.value.trim().toLowerCase();
        if (!q) return;
        const scope = perimetre();
        const exact = scope.find((e) => `${nomComplet(e)} — ${e.matricule}`.toLowerCase() === q || e.matricule.toLowerCase() === q);
        const trouves = exact ? [exact] : scope.filter((e) => `${nomComplet(e)} ${e.nom} ${e.prenom} ${e.matricule}`.toLowerCase().includes(q));
        if (trouves.length === 1) { f.employe = trouves[0].matricule; rendre(false); return; }
        toast(trouves.length ? "Plusieurs collaborateurs" : "Aucun collaborateur",
          trouves.length ? `${trouves.length} résultats pour « ${employe.value} » : choisissez dans la liste proposée.` : `Aucun nom ni matricule ne correspond à « ${employe.value} ».`,
          trouves.length ? "info" : "alerte");
      };
      employe.addEventListener("change", choisir);
      employe.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); choisir(); } });
      // Sélection automatique dès que la saisie désigne une seule personne.
      employe.addEventListener("input", debounce(() => {
        const q = employe.value.trim().toLowerCase();
        if (q.length < 2) return;
        const scope = perimetre();
        const exact = scope.find((e) => `${nomComplet(e)} — ${e.matricule}`.toLowerCase() === q || e.matricule.toLowerCase() === q);
        const trouves = exact ? [exact] : scope.filter((e) => `${nomComplet(e)} ${e.nom} ${e.prenom} ${e.matricule}`.toLowerCase().includes(q));
        if (trouves.length !== 1 || trouves[0].matricule === f.employe) return;
        f.employe = trouves[0].matricule;
        rendre(false);
        const champ = $("#filtre-employe");
        if (champ) { champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length); }
      }, 350));
      employe.addEventListener("focus", () => employe.select());
    }
    const badge = $("#badger");
    if (badge) badge.addEventListener("click", badger);
    $$("[data-justifier]").forEach((b) => b.addEventListener("click", () => ouvrirJustification(Number(b.dataset.justifier))));
    const precedent = $("#mois-precedent"), suivant = $("#mois-suivant"), exportM = $("#export-mensuel");
    if (precedent) precedent.addEventListener("click", () => { f.mois = Math.max(0, f.mois - 1); rendre(false); });
    if (suivant) suivant.addEventListener("click", () => { f.mois = Math.min(AUJOURDHUI.getMonth(), f.mois + 1); rendre(false); });
    if (exportM) exportM.addEventListener("click", () => toast("Export Excel", `Pointages de ${MOIS[f.mois]} — mise en page Veltaris générée par le backend.`, "info"));
  }

  if (etat.route === "/plannings") {
    const f = etat.filtres.planning;
    const prec = $("#semaine-precedente"), suiv = $("#semaine-suivante"), auj = $("#semaine-aujourdhui");
    if (prec) prec.addEventListener("click", () => { f.decalage--; rendre(false); });
    if (suiv) suiv.addEventListener("click", () => { f.decalage++; rendre(false); });
    if (auj) auj.addEventListener("click", () => { f.decalage = 0; rendre(false); });
    const dept = $("#filtre-dept-planning");
    if (dept) dept.addEventListener("change", (e) => { f.dept = e.target.value; rendre(false); });
    [$("#dupliquer-semaine"), $("#dupliquer-vide")].forEach((b) => b && b.addEventListener("click", dupliquerSemaine));
    brancherPlanning();
  }

  if (etat.route === "/documents") {
    $$("[data-signer]").forEach((b) => b.addEventListener("click", () => ouvrirSignature(b.dataset.signer)));
    $$("[data-doc]").forEach((b) => b.addEventListener("click", () => {
      const doc = DOCUMENTS.find((d) => d.id === Number(b.dataset.doc));
      toast("Téléchargement", `${doc.titre} — le PDF est généré par le backend.`, "info");
    }));
  }

  if (etat.route === "/administration") {
    const f = etat.filtres.admin;
    $$("#onglets-admin button").forEach((b) => b.addEventListener("click", () => { f.onglet = b.dataset.onglet; rendre(false); }));
    const recherche = $("#admin-recherche");
    if (recherche) recherche.addEventListener("input", debounce((e) => {
      f.recherche = e.target.value; rendre(false);
      const champ = $("#admin-recherche");
      champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length);
    }, 280));
    const dept = $("#admin-dept");
    if (dept) dept.addEventListener("change", (e) => { f.dept = e.target.value; rendre(false); });
    const nouveau = $("#nouvel-employe");
    if (nouveau) nouveau.addEventListener("click", () => ouvrirFicheEmploye(null));
    $$("[data-editer]").forEach((b) => b.addEventListener("click", () => ouvrirFicheEmploye(b.dataset.editer)));
    $$("[data-solde]").forEach((b) => b.addEventListener("click", () => ouvrirAjustementSolde(b.dataset.solde)));
    $$("[data-fiche]").forEach((b) => b.addEventListener("click", () => ouvrirFicheEmploye(b.dataset.fiche)));
    $$("[data-export]").forEach((b) => b.addEventListener("click", () => toast("Export en préparation", `${b.dataset.export} — document aux couleurs de la marque Assurance.`, "info")));
    const lancer = $("#lancer-import");
    if (lancer) lancer.addEventListener("click", () => {
      const fichier = $("#fichier-import").files[0];
      if (!fichier) return toast("Aucun fichier", "Sélectionnez l'export de la pointeuse à importer.", "danger");
      JOURNAL.unshift({ action: "Import de pointages", cible: fichier.name, acteur: moi().matricule, detail: "Import simulé — traitement réel côté FastAPI", date: new Date() });
      toast("Import lancé", `${fichier.name} — les anomalies seront recalculées automatiquement.`, "succes");
      rendre(false);
    });
    if (f && f.onglet === "synthese") graphiqueSynthese();
  }

  // Rubriques déclarées par les modules additionnels.
  if (typeof BRANCHEMENTS !== "undefined" && BRANCHEMENTS[etat.route]) BRANCHEMENTS[etat.route]();
}

function debounce(fn, delai) {
  let minuterie;
  return (...args) => { clearTimeout(minuterie); minuterie = setTimeout(() => fn(...args), delai); };
}

/* ==========================================================================
   19. DÉMARRAGE
   ========================================================================== */
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (etat.utilisateur) ouvrirPalette();
  }
});

const themeEnregistre = stockage.lire("portail-theme", null);
if (themeEnregistre) document.documentElement.setAttribute("data-theme", themeEnregistre);

const routeInitiale = location.hash.replace("#", "");
if (routeInitiale && TITRES[routeInitiale]) etat.route = routeInitiale;

rendre();
