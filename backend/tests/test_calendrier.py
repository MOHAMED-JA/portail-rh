"""Décompte des congés selon la règle Veltaris."""
from datetime import date

from app.services.calendrier import compter_jours_conge, est_ferie


def test_semaine_lundi_vendredi_vaut_cinq_jours():
    assert compter_jours_conge(date(2026, 10, 5), date(2026, 10, 9)) == 5


def test_week_ends_en_bordure_ne_comptent_pas():
    # Du samedi au dimanche suivant : seuls les cinq jours ouvrés comptent.
    assert compter_jours_conge(date(2026, 10, 3), date(2026, 10, 11)) == 5


def test_deux_semaines_comptent_le_week_end_intermediaire():
    assert compter_jours_conge(date(2026, 10, 19), date(2026, 10, 30)) == 12


def test_jour_ferie_non_decompte():
    assert est_ferie(date(2026, 10, 15))  # Fête de l'Évacuation
    assert compter_jours_conge(date(2026, 10, 12), date(2026, 10, 16)) == 4


def test_demi_journee():
    assert compter_jours_conge(date(2026, 10, 5), date(2026, 10, 5), "matin") == 0.5
    assert compter_jours_conge(date(2026, 10, 5), date(2026, 10, 6), "apres_midi") == 1.5


def test_periode_uniquement_week_end():
    assert compter_jours_conge(date(2026, 10, 10), date(2026, 10, 11)) == 0
