/* ==========================================================================
   59. SUPERVISION TECHNIQUE
   Erreurs regroupées, dernier état des traitements automatiques et contrôle
   d'intégrité des sauvegardes. Réservé à l'administrateur RH.
   ========================================================================== */
function dateSupervision(valeur) {
  return valeur ? dateServeur(valeur).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" }) : "Jamais";
}

function adminSupervision() {
  if (!connecte()) return reserveServeur("La supervision technique");
  const d = chargerEtat("supervisionRH", () => API.appel("/api/supervision"));
  if (!d) return squelette(320);
  const ouverts = d.incidents.filter((i) => !i.resolu_le);
  const echecs = d.taches.filter((t) => t.statut === "echec");
  const sauvegarde = d.sauvegardes || { statut: "absente", fichiers: [] };
  return `<div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
    ${carteKpi({ cle: "sup1", libelle: "Incidents ouverts", valeur: ouverts.length, unite: "", icone: "alerte", couleur: ouverts.length ? "var(--danger)" : "var(--succes)", fond: ouverts.length ? "var(--danger-doux)" : "var(--succes-doux)", detail: ouverts.length ? "à examiner" : "aucun incident" })}
    ${carteKpi({ cle: "sup2", libelle: "Tâches en échec", valeur: echecs.length, unite: "", icone: "horloge", couleur: echecs.length ? "var(--danger)" : "var(--marine)", fond: echecs.length ? "var(--danger-doux)" : "var(--marine-doux)", detail: `${d.taches.length} tâche(s) suivie(s)` })}
    ${carteKpi({ cle: "sup3", libelle: "Sauvegardes", valeur: sauvegarde.statut === "ok" ? "OK" : "À vérifier", unite: "", icone: "bouclier", couleur: sauvegarde.statut === "ok" ? "var(--succes)" : "var(--alerte)", fond: sauvegarde.statut === "ok" ? "var(--succes-doux)" : "var(--alerte-doux)", detail: sauvegarde.age_heures != null ? `dernière il y a ${fmtNombre(sauvegarde.age_heures, 1)} h` : sauvegarde.mode || "" })}
  </div>
  <div class="sirh-section"><div class="carte-entete"><h4>Traitements automatiques</h4><span class="aide">Dernier état consolidé</span></div>
    ${d.taches.length ? `<div class="tableau-boite"><table style="min-width:760px"><thead><tr><th>Tâche</th><th>État</th><th>Dernière exécution</th><th>Durée</th><th>Exécutions / échecs</th><th>Détail</th></tr></thead><tbody>${d.taches.map((t) => `<tr>
      <td><strong>${echapper(t.nom.replaceAll("_", " "))}</strong></td><td><span class="badge ${t.statut === "succes" ? "approuvee" : t.statut === "echec" ? "annulee" : "neutre"}">${echapper(t.statut)}</span></td>
      <td class="mono">${dateSupervision(t.derniere_execution)}</td><td>${t.duree_ms == null ? "—" : `${t.duree_ms} ms`}</td><td>${t.executions} / ${t.echecs}</td><td>${echapper(t.detail || "—")}</td></tr>`).join("")}</tbody></table></div>` : etatVide("horloge", "Aucune exécution enregistrée", "Les états apparaîtront après le prochain passage des tâches de fond.")}
  </div>
  <div class="sirh-section"><div class="carte-entete"><h4>Incidents techniques</h4><span class="aide">Les répétitions identiques sont regroupées</span></div>
    ${d.incidents.length ? `<div class="tableau-boite"><table style="min-width:760px"><thead><tr><th>Dernière occurrence</th><th>Source</th><th>Erreur</th><th>Occurrences</th><th>État</th><th></th></tr></thead><tbody>${d.incidents.map((i) => `<tr>
      <td class="mono">${dateSupervision(i.derniere_le)}</td><td>${echapper(i.source)}</td><td><strong>${echapper(i.type_erreur)}</strong><div class="aide">${echapper(i.message)}</div></td><td>${i.occurrences}</td>
      <td><span class="badge ${i.resolu_le ? "neutre" : "annulee"}">${i.resolu_le ? "Résolu" : "Ouvert"}</span></td><td>${i.resolu_le ? "" : `<button class="btn petit" data-resoudre-incident="${i.id}">Classer résolu</button>`}</td></tr>`).join("")}</tbody></table></div>` : etatVide("bouclier", "Aucun incident", "Les erreurs inattendues du serveur apparaîtront ici.")}
  </div>
  <div class="sirh-section"><div class="carte-entete"><div><h4>Sauvegardes</h4><div class="sous">${echapper(sauvegarde.message || `${(sauvegarde.fichiers || []).length} sauvegarde(s) contrôlée(s)`)}</div></div>
    <div style="display:flex;gap:8px"><button class="btn petit" id="controler-sauvegardes">${ico("bouclier")} Contrôler l'intégrité</button>${sauvegarde.mode === "sqlite" ? `<button class="btn petit primaire" id="sauvegarder-maintenant">${ico("telecharger")} Sauvegarder maintenant</button>` : ""}</div></div>
    ${(sauvegarde.fichiers || []).length ? `<div class="tableau-boite"><table><thead><tr><th>Fichier</th><th>Date</th><th>Taille</th><th>Intégrité</th></tr></thead><tbody>${sauvegarde.fichiers.map((f) => `<tr><td class="mono">${echapper(f.nom)}</td><td>${f.modifie_le ? dateSupervision(f.modifie_le) : "—"}</td><td>${f.taille_ko || 0} Ko</td><td><span class="badge ${f.statut === "ok" ? "approuvee" : "annulee"}">${echapper(f.statut)}</span></td></tr>`).join("")}</tbody></table></div>` : ""}
  </div>`;
}

const vueAdminAvantSupervision = VUES["/administration"];
VUES["/administration"] = function () {
  const f = etat.filtres.admin || (etat.filtres.admin = { onglet: "employes", recherche: "", dept: "" });
  if (f.onglet === "supervision" && (estGestionnaire() || !connecte())) f.onglet = "employes";
  const html = vueAdminAvantSupervision();
  if (estGestionnaire()) return html;
  const bouton = `<button data-onglet="supervision" class="${f.onglet === "supervision" ? "actif" : ""}">Supervision</button>`;
  if (f.onglet !== "supervision") return html.replace('<button data-onglet="import"', `${bouton}<button data-onglet="import"`);
  return `<section class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div class="segment" id="onglets-admin" style="flex-wrap:wrap">
    <button data-onglet="employes">Employés</button><button data-onglet="affectations">Affectations</button><button data-onglet="alertes">Alertes RH</button><button data-onglet="report">Report des congés</button><button data-onglet="documents">Documents demandés</button><button data-onglet="suivi">Suivi des fiches</button><button data-onglet="sorties">Sorties</button><button data-onglet="departements">Départements</button><button data-onglet="synthese">Synthèse</button><button data-onglet="organigramme">Organigramme</button><button data-onglet="journal">Journal d'audit</button><button data-onglet="securite">Sécurité</button>${bouton}<button data-onglet="import">Import & exports</button>
    </div></div>${adminSupervision()}</section>`;
};

const brancherAdminAvantSupervision = BRANCHEMENTS["/administration"];
BRANCHEMENTS["/administration"] = function () {
  if (brancherAdminAvantSupervision) brancherAdminAvantSupervision();
  const f = etat.filtres.admin;
  if (!f || f.onglet !== "supervision") return;
  $$("#onglets-admin button").forEach((b) => b.addEventListener("click", () => { if (b.dataset.onglet !== "supervision") etat.supervisionRH = null; }));
  $$('[data-resoudre-incident]').forEach((b) => b.addEventListener("click", async () => {
    try { await API.appel(`/api/supervision/incidents/${b.dataset.resoudreIncident}/resoudre`, { methode: "POST" }); etat.supervisionRH = null; toast("Incident classé", "L'incident est marqué comme résolu.", "succes"); rendre(false); }
    catch (souci) { toast("Action refusée", souci.message, "danger"); }
  }));
  const controle = $("#controler-sauvegardes");
  if (controle) controle.addEventListener("click", async () => {
    controle.disabled = true;
    try { await API.appel("/api/supervision/sauvegardes/controler", { methode: "POST" }); etat.supervisionRH = null; toast("Contrôle terminé", "L'intégrité des sauvegardes récentes a été vérifiée.", "succes"); rendre(false); }
    catch (souci) { toast("Contrôle impossible", souci.message, "danger"); }
  });
  const sauvegarder = $("#sauvegarder-maintenant");
  if (sauvegarder) sauvegarder.addEventListener("click", async () => {
    sauvegarder.disabled = true;
    try { await API.appel("/api/sirh/sauvegardes", { methode: "POST" }); etat.supervisionRH = null; toast("Sauvegarde créée", "La copie a été contrôlée et ajoutée à la liste.", "succes"); rendre(false); }
    catch (souci) { toast("Sauvegarde impossible", souci.message, "danger"); }
  });
};
