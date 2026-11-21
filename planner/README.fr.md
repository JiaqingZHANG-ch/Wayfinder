# Solveur d'emploi du temps (planner)

🇫🇷 Version française · 🇨🇳 [中文说明](README.md)

C'est le moteur de planification de Wayfinder. Il reçoit la situation d'une personne pour une journée (cours, horaires de bus, repas, habitudes à garder, projets et échéances) et calcule avec un solveur de contraintes (Google OR-Tools CP-SAT) un emploi du temps heure par heure **réaliste pour un humain**. Toutes les règles viennent des données d'entrée et ne visent personne en particulier : les cours, les habitudes et le rythme de chacun sont remplis par l'accueil et les réglages de Wayfinder.

## Ce qu'il prend en compte

1. **Contraintes dures** : cours et examens, sommeil, repas, trajets. Le bus du retour est choisi au moins 20 minutes après la fin du cours (réglable), et des minutes de transition sont laissées avant et après chaque déplacement.
2. **Habitudes quotidiennes** : chacune a une durée et une plage horaire ; on peut préciser qu'elle se fait seulement à la maison, qu'elle peut se faire pendant le trajet, ou que plusieurs habitudes se font d'un seul bloc. Si une habitude ne rentre pas, elle n'est pas effacée en silence : le programme explique ce qui la bloque.
3. **Projets** : ils se partagent le temps restant. L'urgence dépend de la **marge** (le temps disponible avant l'échéance moins le travail qui reste), pas seulement de la date limite ; la concentration totale de la journée a une limite, et les jours chargés en cours laissent moins de place aux projets.
4. **Énergie** : cours, habitudes et projets ont chacun un coût, plus faible pour ce qu'on aime ; quand l'énergie déclarée du jour est basse, seules les versions minimales des habitudes sont planifiées.
5. **Replanifier seulement la fin de la journée** : si quelque chose change, ce qui est passé ne bouge pas, seul le reste est recalculé.

Ensuite, une **vérification indépendante** relit le plan : pas de chevauchement, un bus pour chaque trajet, assez de temps après les cours, rien de « à la maison » placé pendant qu'on est à l'université, assez de sommeil. Si une règle n'est pas respectée, le programme refuse de produire le plan et dit pourquoi.

## Exemple

`examples/2026-11-16.json` décrit le lundi d'un étudiant fictif (cours, examen de mi-semestre, TP l'après-midi). Le programme propose :

```
06:30 petit-déjeuner → 07:11 départ (anglais pendant le trajet)
08:00 cours → 10:15 examen → 12:15 déjeuner
13:00–15:30 temps libre
15:30 TP → 17:51 bus du retour → 18:21 dîner
19:06 journal → 20:06 lecture → 20:36 étirements
```

Il prend le bus de 17h51 et non celui de 17h35, trop proche de la fin du TP ; comme les cours et l'examen ont déjà consommé une grande partie de l'énergie, il ne place pas de projet le soir et le signale. Le dossier `examples/users/` contient aussi les réglages complets de quelques utilisateurs fictifs.

## Lancer le programme

```powershell
.\run.ps1 examples\2026-11-16.json -o out.json
```

Tests : `uv run pytest` (84 tests)

Le format d'entrée est décrit dans `src/planner/model.py`, la liste des règles et leur origine dans `docs/constraints.md`.

## Données et vie privée

Les vraies données restent dans `data/` (exclu du dépôt par `.gitignore`). Le dossier `examples/` ne contient que des personnes fictives.
