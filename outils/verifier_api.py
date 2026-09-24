"""Vérification de bout en bout de l'API : connexion, création d'un utilisateur,
dépôt d'une demande, validation, décrément du solde.

Usage :  backend/.venv/Scripts/python.exe outils/verifier_api.py
"""
import json
import urllib.error
import urllib.request
from datetime import date, timedelta

BASE = "http://127.0.0.1:8100"


def appel(methode, chemin, corps=None, token=None):
    requete = urllib.request.Request(BASE + chemin, method=methode)
    requete.add_header("Content-Type", "application/json")
    if token:
        requete.add_header("Authorization", f"Bearer {token}")
    donnees = json.dumps(corps).encode() if corps is not None else None
    try:
        with urllib.request.urlopen(requete, donnees, timeout=20) as reponse:
            brut = reponse.read().decode()
            return reponse.status, json.loads(brut) if brut else None
    except urllib.error.HTTPError as erreur:
        return erreur.code, json.loads(erreur.read().decode() or "{}")


def etape(libelle, condition, detail=""):
    print(f"  [{'OK ' if condition else 'KO '}] {libelle}{' — ' + str(detail) if detail else ''}")
    return condition


print("\nVERIFICATION DE L'API PORTAIL RH")
print("=" * 58)

code, sante = appel("GET", "/api/sante")
etape("API joignable", code == 200, sante)

code, session = appel("POST", "/api/auth/login", {"matricule": "VT0002", "mot_de_passe": "demo2026"})
etape("Connexion administrateur RH", code == 200, session["utilisateur"]["nom"] if code == 200 else session)
token_admin = session["access_token"]

code, mauvais = appel("POST", "/api/auth/login", {"matricule": "VT0002", "mot_de_passe": "faux"})
etape("Mot de passe invalide rejeté", code == 401)

code, employes = appel("GET", "/api/administration/employes", token=token_admin)
etape("Liste des employés", code == 200, f"{len(employes)} collaborateurs")

# --- Création d'un nouvel utilisateur ------------------------------------
matricule = f"VT9{date.today().strftime('%H%M')[-3:]}"
nouveau = {
    "matricule": matricule,
    "nom": "Démonstration",
    "prenom": "Utilisateur",
    "email": f"{matricule.lower()}@veltaris.example",
    "poste": "Chargé d'études",
    "date_entree": date.today().isoformat(),
    "departement_id": 1,
    "validateur_id": 3,
    "role": "employe",
    "mot_de_passe": "demo2026",
    "jours_acquis": 21,
}
code, cree = appel("POST", "/api/administration/employes", nouveau, token_admin)
etape("Création d'un utilisateur", code == 201, f"{matricule} — id {cree.get('id')}" if code == 201 else cree)

code, session2 = appel("POST", "/api/auth/login", {"matricule": matricule, "mot_de_passe": "demo2026"})
etape("Connexion du nouvel utilisateur", code == 200)
token_employe = session2["access_token"] if code == 200 else None

code, doublon = appel("POST", "/api/administration/employes", nouveau, token_admin)
etape("Matricule en double refusé", code == 409, doublon.get("detail"))

# --- Dépôt puis validation d'une demande ---------------------------------
debut = date.today() + timedelta(days=14)
fin = debut + timedelta(days=2)
code, simulation = appel(
    "GET",
    f"/api/demandes/simulation-conge?date_debut={debut}&date_fin={fin}&sous_type=annuel",
    token=token_employe,
)
etape("Simulation de solde", code == 200,
      f"{simulation['nombre_jours']} j, reste {simulation['jours_restants_apres']} j" if code == 200 else simulation)

code, demande = appel("POST", "/api/demandes/conge", {
    "sous_type": "annuel", "date_debut": debut.isoformat(), "date_fin": fin.isoformat(),
    "commentaire": "Demande créée par le script de vérification",
}, token_employe)
etape("Dépôt d'une demande de congé", code == 201, demande.get("reference"))

code, avant = appel("GET", f"/api/administration/employes/{cree['id']}/soldes", token=token_admin)
solde_avant = avant[0]["jours_restants"]

code, file = appel("GET", "/api/demandes/a-valider", token=token_admin)
etape("Demande visible dans la file de validation",
      any(d["reference"] == demande["reference"] for d in file), f"{len(file)} en attente")

code, validee = appel("POST", f"/api/demandes/{demande['id']}/approuver",
                      {"commentaire": "Accord direction"}, token_admin)
etape("Approbation", code == 200 and validee["statut"] == "approuvee")

code, apres = appel("GET", f"/api/administration/employes/{cree['id']}/soldes", token=token_admin)
solde_apres = apres[0]["jours_restants"]
etape("Solde décrémenté à l'approbation finale",
      solde_apres == solde_avant - demande["nombre_jours"],
      f"{solde_avant} j -> {solde_apres} j")

code, notifs = appel("GET", "/api/notifications", token=token_employe)
etape("Notification reçue par le demandeur", code == 200 and len(notifs) > 0,
      notifs[0]["titre"] if code == 200 and notifs else "")

code, tableau = appel("GET", "/api/tableau-bord", token=token_employe)
etape("Tableau de bord alimenté", code == 200,
      f"solde {tableau['solde']['jours_restants']} j" if code == 200 else tableau)

print("=" * 58)
print(f"Utilisateur de test cree : {matricule} / demo2026\n")
