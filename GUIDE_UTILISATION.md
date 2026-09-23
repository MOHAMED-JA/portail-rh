# Guide d'utilisation

Ce guide fait découvrir le portail en une vingtaine de minutes, avec les comptes
de démonstration. Toutes les personnes sont fictives : vous pouvez tout essayer
sans risque, puis repartir d'une base neuve (voir « Remettre à zéro »).

## 1. Se connecter

Lancez le portail (voir le [README](README.md)) et ouvrez http://127.0.0.1:8000.

1. Choisissez un **profil** : Utilisateur, Supérieur hiérarchique ou
   Administrateur RH. Un compte ne peut pas prendre un profil plus élevé que le
   sien.
2. Saisissez le **matricule** et le **mot de passe**, puis cliquez sur
   **Se connecter** (l'œil du champ affiche le mot de passe).

**Mot de passe de tous les comptes de démonstration : `demo2026`**

| Matricule | Profil à choisir | Personne (fictive) | Pour essayer |
|---|---|---|---|
| `VT0010` | Utilisateur | Julien Garnier, ingénieur, Systèmes d'information | Demandes, pointages, fiche d'objectifs, notes de frais |
| `VT0011` | Utilisateur | Léa Fontaine, même équipe que Julien | Un second collaborateur de la même équipe |
| `VT0003` | Supérieur hiérarchique | Karim Delorme, responsable de Julien et Léa | Validations, tableau d'équipe, évaluation |
| `VT0004` | Supérieur hiérarchique | Sophie Marchand, responsable d'une autre équipe | Constater qu'un manager ne voit que son équipe |
| `VT0002` | Administrateur RH | Nadia Roche, directrice des ressources humaines | Administration, paramètres, note de comportement, rapports |

Tous les collaborateurs ont un matricule `VT00xx` et le même mot de passe :
la rubrique **Annuaire** les liste.

Le bouton rouge **Déconnexion** est en haut à droite. Le soleil ou la lune de
l'en-tête passe en thème sombre.

## 2. Se repérer

Le menu est rangé en trois groupes (sur téléphone : barre du bas et bouton
**Plus**) :

- **Espace personnel** : Tableau de bord, Mes demandes, Présences, Plannings,
  Notes de frais, Formations, Fiche d'objectifs, Fiche d'évaluation, Mes documents.
- **Équipe** (supérieurs et RH) : À valider, Annuaire, Organigramme, Calendrier
  d'équipe, Arrivées et départs.
- **Pilotage** (RH) : Rapports, Bilan social, Administration RH, Paramètres RH.

**Ctrl + K** ouvre la recherche globale. La cloche de l'en-tête regroupe les
notifications.

## 3. Scénarios pas à pas

### Demander un congé, puis le faire valider

1. Connecté en **`VT0010`** (Utilisateur), cliquez sur **Demander un congé**
   depuis le tableau de bord.
2. Choisissez les dates : le nombre de jours et le solde restant se calculent en
   direct (week-ends et jours fériés exclus). Envoyez.
3. Déconnectez-vous, reconnectez-vous en **`VT0003`** (Supérieur hiérarchique).
   La demande attend dans **À valider** : approuvez-la ou refusez-la avec un motif.
4. Revenez en `VT0010` : la notification est arrivée, et le solde est à jour.

Une demande qui dépasse le solde n'est pas bloquée : elle part directement aux RH
(`VT0002`), avec le dépassement bien signalé.

### Demander une autorisation d'absence

Depuis le tableau de bord, **Autorisation d'absence** : quelques heures dans la
journée. Au plus 1 h 30 par autorisation et 4 h par mois ; au-delà, la demande
devient une dérogation que seuls les RH décident.

### Rédiger sa fiche d'objectifs, jusqu'à l'évaluation

1. En **`VT0010`**, ouvrez **Fiche d'objectifs** : ajoutez des objectifs
   (intitulé, indicateur, pondération). Le total doit faire 100 %.
   **Soumettez** la fiche à votre supérieur.
2. En **`VT0003`**, onglet **Fiches de mon équipe** : validez la fiche, modifiez-la
   ou renvoyez-la pour correction.
3. Une fois les objectifs validés, la **Fiche d'évaluation** s'ouvre : le
   supérieur note chaque objectif sur 20.
4. En **`VT0002`** (RH), saisissez la **note de comportement** sur 20.
5. Note finale = **80 % objectifs** (moyenne pondérée) **+ 20 % comportement**.
   Le collaborateur reçoit ses notes une fois l'évaluation validée par le
   supérieur et par les RH ; il la consulte ensuite en lecture seule.

### Présences et pointages

**Présences** affiche chaque passage à la pointeuse et les anomalies (retard,
départ anticipé, pointage manquant). Seul le collaborateur concerné justifie ses
anomalies ; ses supérieurs et les RH les voient comme des indicateurs.

### Note de frais

**Notes de frais** : saisissez les dépenses, joignez les justificatifs (PDF, DOC
ou DOCX) et **transmettez**. Le supérieur approuve, puis les RH marquent la note
**remboursée**. Chaque étape est notifiée.

### Organigramme et équipe

- **Organigramme** : arbre ou liste, recherche d'une personne, zoom, impression.
- En `VT0003`, le **tableau de bord de l'équipe** montre les absents du jour, les
  demandes en attente et les fiches à traiter.
- **Calendrier d'équipe** : un jour où plus d'un quart de l'équipe est absent
  est signalé, avec des remplaçants possibles.

### Côté RH (`VT0002`)

- **Administration RH** : créer ou modifier un collaborateur, réinitialiser un
  mot de passe, sécurité (comptes bloqués, historique des connexions),
  import Excel, qualité des données.
- **Paramètres RH** : horaires, tolérance de retard, types de congé, jours fériés
  mobiles, seuils de validation. Les changements s'appliquent immédiatement.
- **Rapports** et **Bilan social** : indicateurs, graphiques, exports Excel et PDF.
- **Mes documents** : attestations PDF vérifiables par QR code.

## 4. Règles appliquées par défaut

Le portail est réglé sur le droit du travail tunisien, son pays d'origine ;
l'essentiel se modifie dans **Paramètres RH**.

| Règle | Valeur par défaut |
|---|---|
| Semaine | Lundi à vendredi |
| Horaire | 8 h – 12 h et 13 h – 17 h ; séance unique 8 h – 14 h en juillet et août |
| Acquisition des congés | 2,5 jours par mois, crédités le 1er du mois suivant |
| Décompte d'un congé | Jours ouvrés : week-ends et jours fériés exclus |
| Autorisations | 1 h 30 au plus par demande, 4 h par mois |
| Validation | Supérieur hiérarchique, puis RH selon les cas ; validation automatique après 48 h sans réponse |
| Mot de passe | 8 caractères minimum, lettres et chiffres ; blocage 15 min après 5 échecs |

## 5. Sur un téléphone

Le portail s'adapte à l'écran d'un téléphone. Pour l'essayer sur le vôtre (même
Wi-Fi que l'ordinateur), double-cliquez sur `TESTER_SUR_TELEPHONE.bat`, puis
ouvrez dans le navigateur du téléphone l'adresse affichée.

## 6. Remettre à zéro

Pour repartir d'une base de démonstration neuve :

```bash
cd backend
python -m app.seed --reset
```

Sans serveur, en ouvrant directement `portail-rh.html`, le portail fonctionne
aussi en **mode démonstration** : il suffit de cliquer sur un profil, rien n'est
enregistré.

## 7. Donner votre avis

Un écran peu clair, un comportement inattendu, une idée ? Ouvrez une « issue » sur
le dépôt GitHub en précisant le compte utilisé, ce que vous faisiez et ce que vous
attendiez. N'y mettez jamais de données personnelles réelles.
