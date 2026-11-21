# Planificateur de journée (daily-planner)

🇫🇷 Version française · 🇨🇳 [中文说明](README.md)

Un petit programme qui organise automatiquement ma journée : cours, trajets en bus, repas, habitudes quotidiennes et projets. L'idée est née du cours d'optimisation (programmation linéaire et programmation par contraintes) de mon Master à l'Université de Caen Normandie : chaque jour, je dois faire entrer beaucoup de choses dans un temps limité, et c'est exactement un problème de planification sous contraintes.

Le projet est en cours. Cette première étape planifie **une seule journée**.

## Pourquoi ce projet

- J'ai cinq ou six projets en parallèle, des cours tous les jours et des habitudes que je veux garder (lecture, calligraphie, anglais, sport).
- Faire le planning à la main prend du temps et donne parfois un plan impossible à suivre (par exemple prendre un bus cinq minutes après la fin d'un cours).
- Je voulais un plan **réaliste pour un humain**, qui change le moins possible d'un jour à l'autre, et qui explique pourquoi il place chaque tâche à tel moment.

## Ce que fait le programme

Le programme lit un fichier JSON qui décrit la journée, calcule un emploi du temps, le vérifie, puis l'écrit dans un autre fichier JSON.

Il respecte trois niveaux de règles, dans cet ordre :

1. **Obligatoire (contraintes dures)** : les cours et examens, le sommeil, les repas, les trajets. Le bus du retour est choisi au moins 20 minutes après la fin du dernier cours (le cours peut finir en retard, il faut ranger ses affaires et marcher jusqu'à l'arrêt). Avant et après chaque déplacement, le programme laisse quelques minutes de transition.
2. **Habitudes quotidiennes** : lecture, calligraphie, anglais… chacune a une durée fixe et une plage horaire. Si une habitude ne rentre pas, le programme ne l'efface pas en silence : il explique ce qui la bloque.
3. **Projets** : ils se partagent le temps qui reste. Le plus urgent passe en premier. L'urgence ne dépend pas seulement de la date limite mais de la **marge** : le temps disponible avant l'échéance moins le travail qui reste. Un petit devoir pour demain peut être moins urgent qu'un gros projet pour dans dix jours. Une tâche longue est découpée en blocs d'au moins deux heures, et la charge de travail de la journée a une limite (moins de travail les jours où il y a beaucoup de cours).

Ensuite, une **vérification indépendante** relit le plan : pas de chevauchement, un bus pour chaque trajet, assez de temps après les cours, aucune tâche « à la maison » placée pendant que je suis à l'université, huit heures de sommeil. Si une règle n'est pas respectée, le programme refuse de produire le plan et dit pourquoi.

## Exemple : le lundi 16 novembre 2026

Avec mon vrai emploi du temps de ce jour-là (cours le matin, examen à 10h15, TP de 15h30 à 17h30), le programme propose :

```
06:15 calligraphie → 06:35 petit-déjeuner → 07:11 départ (anglais pendant le trajet)
08:00 cours → 10:15 examen → 12:15 déjeuner
13:00–15:00 projet, à la bibliothèque de l'université
15:30 TP → 17:51 bus du retour → 18:21 dîner
19:06 projet → 19:46 français → 20:30 lecture
```

Il prend le bus de 17h51 et non celui de 17h35, trop proche de la fin du TP.

## Outils

- **Python 3.12**
- **OR-Tools CP-SAT** (Google) : le solveur de programmation par contraintes qui calcule le planning.
- **pytest** : 30 tests automatiques, dont des cas tirés de vraies erreurs de planification (bus impossible, tâche placée au réveil, nom de lieu mal écrit…).

## Lancer le programme

```powershell
.\run.ps1 examples\2026-11-16.json -o out.json
```

Tests : `uv run pytest`

Le fichier d'entrée est décrit dans `src/planner/model.py`. Le résultat contient, pour chaque bloc, l'heure de début et de fin, le type (cours, habitude, projet…) et, pour les projets, une phrase qui explique pourquoi ils sont placés là.

## Limites actuelles

- Une seule journée à la fois (pas encore la semaine).
- Pas encore de « perturbation minimale » : quand quelque chose change (cours annulé, nouvelle échéance), le programme recalcule tout au lieu de modifier le moins possible le plan d'origine.
- Les trajets vers un lieu autre que la maison ou l'université sont estimés à 30 minutes.
- La limite d'attention sur toute la journée (environ 8 heures de vraie concentration) n'est pas encore modélisée ; pour l'instant seule la charge des projets est limitée.

## Prochaines étapes

1. Planifier sept jours d'un coup.
2. Replanifier en changeant le moins possible le plan existant.
3. Gérer les réunions « à confirmer » et les changements dans la journée.
4. Modéliser la limite d'attention de la journée.

## Données et vie privée

Les vraies données personnelles restent dans `data/` (exclu du dépôt). Le dossier `examples/` ne contient qu'un exemple sans nom réel.
