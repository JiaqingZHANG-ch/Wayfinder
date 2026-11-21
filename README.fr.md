# Wayfinder

[中文版](README.md)

Un mentor IA pour les jeunes qui ne savent pas trop où ils vont : d'abord clarifier une direction, puis recevoir chaque jour un plan qu'on peut commencer tout de suite, faire le point le soir et un bilan chaque semaine. Pour l'instant, c'est une version locale, pour une seule personne.

## Contenu du dépôt

| Dossier | Contenu |
|---|---|
| `src/`, `tests/` | Le backend (FastAPI + SQLite), le mentor, le conseil de perspectives et les entretiens approfondis |
| `mobile/` | L'application (Expo : version web + téléphone) |
| `planner/` | Le solveur d'emploi du temps (CP-SAT), c'est l'ancien dépôt daily-planner, avec tout son historique ; voir `planner/README.fr.md` |
| `docs/` | Backend, interface, inventaire des données, conceptions et plans |
| `supabase/` | Migrations de la base de données cloud (pas encore testées sur une vraie base) |

## Lancer Wayfinder (version actuelle)

```powershell
.\wayfinder.ps1
```

Ce script démarre en local Ollama, le backend et la version web, puis ouvre <http://localhost:8081>. Pour savoir comment l'utiliser et quoi modifier, voir `docs/backend.md`.

## Ancienne version (le mentor sur une seule page, première étape)

```powershell
.\start.ps1
```

Ouvrir ensuite <http://127.0.0.1:8765> dans le navigateur. Il faut définir la variable d'environnement `DEEPSEEK_API_KEY`.

## Données

- Tout est stocké dans `var/mentor.db` (hors de git). Pour repartir de zéro, fermer le programme et supprimer ce fichier.
- Ce que vous écrivez est envoyé à DeepSeek pour générer les réponses ; à part cela, rien ne quitte cet ordinateur.

## Code

| Fichier | Rôle |
|---|---|
| `src/mentor/store.py` | Base de données : profil, conversations, notes quotidiennes, bilans hebdomadaires |
| `src/mentor/safety.py` | Détection des mots de crise et message d'aide fixe |
| `src/mentor/model.py` | Client DeepSeek |
| `src/mentor/prompts.py` | Les consignes fixes données au modèle, avec le profil et les notes récentes envoyés à chaque fois |
| `src/mentor/mentor.py` | Choisir le sujet du jour, traiter un tour de conversation, vérifier et enregistrer le résultat |
| `src/mentor/ui.py` | Les trois pages : conversation, profil, notes |
| `src/mentor/council.py` | Le conseil : plusieurs perspectives regardent chacune la situation d'une personne, puis leurs avis sont réunis en un conseil |
| `src/mentor/cards/*.md` | Les cartes de perspective ; chacune décrit les outils de réflexion tirés des ouvrages publiés d'un auteur, avec les sources |

À part `ui.py`, rien ne dépend de l'interface : tout peut être repris tel quel dans l'application.

## Le conseil et les cartes

Le conseil se réunit une fois après la création du profil et une fois au début de chaque bilan hebdomadaire, pendant environ une minute. Chaque carte donne une perspective ; les perspectives ne voient pas les avis des autres, puis tout est réuni en un seul conseil.

Les cartes couvrent cinq domaines, deux cartes par domaine. Quand il y a plus de trois domaines, un tri a lieu d'abord : le modèle lit la situation de la personne et choisit les 2 ou 3 domaines les plus pertinents, et seules ces perspectives prennent la parole. S'il n'arrive pas à choisir, ce sont les deux premiers domaines qui sont utilisés.

- Modifier une perspective : modifier directement le fichier correspondant dans `src/mentor/cards/`, puis redémarrer.
- Ajouter une perspective : créer un nouveau `.md`, avec en première ligne `# ××视角（源自某某）` et en deuxième ligne `领域：××`, puis suivre la structure des cartes existantes.
- Chaque principe doit avoir une source. L'utilisateur voit qu'il s'agit d'une simulation par IA à partir d'ouvrages publiés, et non des propos de l'auteur lui-même.
- Aucune carte ne doit contenir de mots liés au fait de se faire du mal : si l'avis d'une perspective en contient, l'accompagnement du jour s'arrête (un test le vérifie).
- Les cartes rangées dans le dossier `成长导师/智囊团卡片/` de la base de connaissances sont des copies destinées à la relecture ; le programme utilise les fichiers de ce dépôt.

## Tests

```powershell
uv run pytest -q
```

Les tests n'utilisent ni le réseau ni le modèle.
