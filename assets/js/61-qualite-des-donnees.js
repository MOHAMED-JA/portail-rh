/* ============================================================================
   61. QUALITÉ DES DONNÉES RH
   Contrôle réservé à l'administrateur : aucune valeur sensible n'est exposée.
   ============================================================================ */
function vueQualiteDonnees() {
  if (!connecte()) return reserveServeur("Le contrôle de qualité des données");
  const rapport = chargerEtat("qualiteDonneesRH", () => API.appel("/api/qualite-donnees"));
  if (!rapport) return squelette(280);
  const filtre = etat.filtres.admin.qualiteGravite || "toutes";
  const lignes = rapport.anomalies.filter((a) => filtre === "toutes" || a.gravite === filtre);
  const badge = (gravite) => `<span class="badge ${gravite === "critique" ? "annulee" : "neutre"}">${gravite === "critique" ? "Critique" : "À compléter"}</span>`;
  return `<div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
    ${carteKpi({ cle: "qd1", libelle: "Effectif contrôlé", valeur: rapport.effectif_actif, unite: "", icone: "users", couleur: "var(--marine)", fond: "var(--marine-doux)", detail: "collaborateurs actifs" })}
    ${carteKpi({ cle: "qd2", libelle: "Anomalies critiques", valeur: rapport.par_gravite.critique, unite: "", icone: "alerte", couleur: rapport.par_gravite.critique ? "var(--danger)" : "var(--succes)", fond: rapport.par_gravite.critique ? "var(--danger-doux)" : "var(--succes-doux)", detail: "structure ou N+1 à corriger" })}
    ${carteKpi({ cle: "qd3", libelle: "Données à compléter", valeur: rapport.par_gravite.attention, unite: "", icone: "doc", couleur: "var(--alerte)", fond: "var(--alerte-doux)", detail: "dossier, poste, e-mail ou solde" })}
  </div>
  <div class="bandeau-info" style="margin-bottom:16px">${ico("bouclier")}<span>Ce contrôle ne modifie aucune donnée. Corrigez le profil ou le dossier depuis l’onglet <strong>Employés</strong>, puis actualisez cette page.</span></div>
  <div class="carte" style="margin-bottom:16px"><div class="carte-entete"><div><h4>Suivi sécurité et conformité</h4><div class="sous">Indicateurs de préparation à la mise en service</div></div></div>
    <div class="tableau-boite"><table style="min-width:620px"><thead><tr><th>Contrôle</th><th>État</th><th>Suivi attendu</th></tr></thead><tbody>
      <tr><td>Sauvegardes et restauration</td><td><span class="badge neutre">À vérifier dans Supervision</span></td><td>Contrôler la sauvegarde quotidienne, puis consigner un test de restauration hors serveur.</td></tr>
      <tr><td>Droits d'accès</td><td><span class="badge info">${Object.values(rapport.droits || {}).reduce((total, nombre) => total + nombre, 0)} comptes actifs</span></td><td>Revoir les comptes RH et les droits élevés : ${(rapport.droits || {}).admin_rh || 0} administrateur(s), ${(rapport.droits || {}).gestionnaire_rh || 0} gestionnaire(s).</td></tr>
      <tr><td>Dossiers RH à compléter</td><td><span class="badge ${rapport.dossiers_a_completer ? "or" : "succes"}">${rapport.dossiers_a_completer || 0} point(s)</span></td><td>Compléter date de naissance, catégorie et dossier depuis Employés.</td></tr>
      <tr><td>Registre INPDP et politique d'archivage</td><td><span class="badge or">Décision RH / DSI requise</span></td><td>Valider la durée de conservation, le lieu de sauvegarde hors serveur et le registre de traitement avant production.</td></tr>
    </tbody></table></div>
  </div>
  <div class="carte" style="margin-bottom:16px"><div class="carte-entete"><div><h4>Recette utilisateur par profil</h4><div class="sous">À faire valider avant mise en service</div></div></div>
    <div class="tableau-boite"><table style="min-width:680px"><thead><tr><th>Profil</th><th>Contrôles essentiels</th><th>Validation attendue</th></tr></thead><tbody>
      <tr><td>Collaborateur</td><td>Connexion, demandes, solde, notification RH si solde insuffisant</td><td>Responsable RH</td></tr>
      <tr><td>Manager</td><td>Calendrier, conflits, remplaçants, validations de son périmètre</td><td>Responsable RH</td></tr>
      <tr><td>RH</td><td>Décisions exceptionnelles, dossiers, sécurité, supervision</td><td>Responsable RH</td></tr>
      <tr><td>Direction générale</td><td>Consultation des analyses et évaluations finalisées</td><td>Direction générale</td></tr>
    </tbody></table></div>
    <p style="font-size:12px;color:var(--encre-3);margin:10px 0 0">La grille détaillée, avec cases de validation et signatures, est disponible dans <code>RECETTE_UTILISATEUR.md</code> à la racine du projet.</p>
  </div>
  <div class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div><h4>Anomalies à traiter</h4><div class="sous">${lignes.length} affichée(s) sur ${rapport.anomalies.length}</div></div><div style="display:flex;gap:8px"><button class="btn petit ${filtre === "toutes" ? "primaire" : ""}" data-qualite-filtre="toutes">Toutes</button><button class="btn petit ${filtre === "critique" ? "primaire" : ""}" data-qualite-filtre="critique">Critiques</button><button class="btn petit ${filtre === "attention" ? "primaire" : ""}" data-qualite-filtre="attention">À compléter</button><button class="btn petit" id="qualite-actualiser">Actualiser</button></div></div>
    ${lignes.length ? `<div class="tableau-boite"><table style="min-width:700px"><thead><tr><th>Priorité</th><th>Collaborateur</th><th>Matricule</th><th>Contrôle</th></tr></thead><tbody>${lignes.map((a) => `<tr><td>${badge(a.gravite)}</td><td><strong>${echapper(a.identite)}</strong></td><td class="mono">${echapper(a.matricule)}</td><td>${echapper(a.libelle)}</td></tr>`).join("")}</tbody></table></div>` : etatVide("bouclier", "Données complètes", "Aucune anomalie n’a été détectée sur l’effectif actif.")}
  </div>`;
}

const vueAdminAvantQualiteDonnees = VUES["/administration"];
VUES["/administration"] = function () {
  const f = etat.filtres.admin || (etat.filtres.admin = { onglet: "employes", recherche: "", dept: "" });
  if (f.onglet === "qualite" && (estGestionnaire() || !connecte())) f.onglet = "employes";
  if (f.onglet === "qualite") return `<section class="carte"><div class="carte-entete" style="flex-wrap:wrap;gap:10px"><div class="segment" id="onglets-admin" style="flex-wrap:wrap"><button data-onglet="employes">Employés</button><button data-onglet="affectations">Affectations</button><button data-onglet="alertes">Alertes RH</button><button data-onglet="report">Report des congés</button><button data-onglet="documents">Documents demandés</button><button data-onglet="suivi">Suivi des fiches</button><button data-onglet="sorties">Sorties</button><button data-onglet="departements">Départements</button><button data-onglet="synthese">Synthèse</button><button data-onglet="organigramme">Organigramme</button><button data-onglet="journal">Journal d'audit</button><button data-onglet="securite">Sécurité</button><button data-onglet="supervision">Supervision</button><button data-onglet="qualite" class="actif">Qualité des données</button><button data-onglet="import">Import & exports</button></div></div>${vueQualiteDonnees()}</section>`;
  const html = vueAdminAvantQualiteDonnees();
  if (estGestionnaire()) return html;
  return html.replace('<button data-onglet="import"', '<button data-onglet="qualite" class="">Qualité des données</button><button data-onglet="import"');
};

const brancherAdminAvantQualiteDonnees = BRANCHEMENTS["/administration"];
BRANCHEMENTS["/administration"] = function () {
  if (brancherAdminAvantQualiteDonnees) brancherAdminAvantQualiteDonnees();
  const f = etat.filtres.admin;
  if (!f || f.onglet !== "qualite" || estGestionnaire()) return;
  $$('[data-qualite-filtre]').forEach((b) => b.addEventListener("click", () => {
    f.qualiteGravite = b.dataset.qualiteFiltre; rendre(false);
  }));
  $("#qualite-actualiser")?.addEventListener("click", () => { etat.qualiteDonneesRH = null; rendre(false); });
};
