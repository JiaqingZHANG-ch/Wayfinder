# Wayfinder

[中文版](README.md)

Un mentor IA pour les jeunes qui ne savent pas trop où ils vont : d'abord clarifier une direction, puis recevoir chaque jour un plan qu'on peut commencer tout de suite, faire le point le soir et un bilan chaque semaine.

C'est un modèle générique, qui ne vise personne en particulier : l'emploi du temps, les habitudes, les projets, le rythme et la direction visée sont remplis par chacun lors de l'accueil, dans les réglages et pendant les entretiens. Pour l'instant, c'est une version locale pour une seule personne (web + téléphone), pas encore en ligne.

## Ce qu'il fait

- **Accueil** : trois minutes pour indiquer son rythme, ses cours, les habitudes à garder et les projets en cours.
- **Le plan du jour** : le solveur place les cours, les trajets, les repas, l'énergie et les échéances dans un emploi du temps heure par heure, et ne propose que ce qui est faisable. Après les cours, on indique son niveau d'énergie : la soirée est replanifiée en conséquence, et on voit ce qui change avant de valider.
- **Le point du soir** : on dit en une phrase ce qu'on a fait ; le modèle en tire l'état de chaque tâche, puis on fixe la chose à faire demain.
- **Le bilan de la semaine** : ce qui a été fait, ce qui a pris moins de place que prévu, une proposition d'ajustement qui ne s'applique que si on dit « d'accord ».
- **Les entretiens approfondis** : après le point du soir, quatre soirées de discussion (situation, direction, énergie, trois versions de soi dans cinq ans) ; un conseil de perspectives commente les trois versions. La mission, les objectifs et la petite habitude d'un mois qui en sortent n'entrent dans le profil qu'une fois confirmés, et le plan quotidien indique ensuite « pour : … ».
- **Vie privée** : toutes les données restent sur l'ordinateur ; on peut tout exporter ou tout supprimer. Si quelqu'un parle de se faire du mal, seuls un message d'aide fixe et des numéros d'écoute s'affichent, jamais un texte libre du modèle.

## Contenu du dépôt

| Dossier | Contenu |
|---|---|
| `src/`, `tests/` | Le backend (FastAPI + SQLite) : mentor, point du soir, bilan, conseil de perspectives, entretiens approfondis |
| `mobile/` | L'application (Expo : version web + téléphone) |
| `planner/` | Le solveur d'emploi du temps (CP-SAT), c'est l'ancien dépôt daily-planner, avec tout son historique ; voir `planner/README.fr.md` |
| `docs/` | Notes sur le backend, règles d'interface, inventaire des données, conceptions et plans |
| `supabase/` | Migrations de base de données pour un futur passage au cloud (pas encore testées sur une vraie base) |

## Le lancer sur son ordinateur

Il faut [uv](https://docs.astral.sh/uv/) (pour Python) et Node.js 22 ou plus ; pour utiliser un modèle local, installer aussi [Ollama](https://ollama.com/) puis lancer `ollama pull qwen3:14b` (environ 9 Go, tourne avec 16 Go de mémoire vidéo).

Sous Windows, en une commande (Ollama, le backend et la version web s'ouvrent chacun dans une fenêtre, puis <http://localhost:8081> s'ouvre) :

```powershell
.\wayfinder.ps1
```

Ou séparément :

```powershell
.\serve.ps1                       # backend, toutes les routes sur http://127.0.0.1:8000/docs
.\web.ps1                         # version web, http://localhost:8081 (lancer d'abord npm install dans mobile/)
```

Pour l'ouvrir sur un téléphone avec Expo Go, voir `docs/backend.md`.

### Quel modèle utiliser

Définir la variable d'environnement `MODEL` avant le lancement :

- `ollama` (par défaut avec `wayfinder.ps1`) : qwen3:14b en local, rien de ce que vous écrivez ne quitte l'ordinateur ;
- `fake` (par défaut avec `serve.ps1`) : sans modèle, le point du soir se fait avec des boutons ; pratique pour regarder l'interface ;
- `deepseek` : il faut définir `DEEPSEEK_API_KEY`, et ce que vous écrivez est envoyé à DeepSeek.

## Données

- Tout est stocké dans `var/app.db` (hors de git). Pour repartir de zéro, arrêter le backend et supprimer ce fichier.
- Dans l'application, « 我 » → « 我的数据 » permet de tout exporter ou de tout supprimer.
- Ce qui est stocké, où et combien de temps : voir `docs/data-inventory.md`.

## Les cartes du conseil

Chaque fichier `src/mentor/cards/*.md` est une perspective : les outils de réflexion tirés des ouvrages publiés d'un auteur, avec les sources. L'utilisateur voit qu'il s'agit d'une simulation par IA à partir d'ouvrages publiés, et non des propos de l'auteur.

- Modifier une perspective : modifier le fichier, puis redémarrer le backend.
- Ajouter une perspective : créer un `.md` avec en première ligne `# ××视角（源自某某）` et en deuxième ligne `领域：××`, puis suivre la structure des cartes existantes ; chaque principe doit avoir une source.
- Aucune carte ne doit contenir de mots liés au fait de se faire du mal : si l'avis d'une perspective en contient, la séance s'arrête et le message d'aide s'affiche (un test le vérifie).

## Tests

```powershell
uv run pytest -q                  # backend, sans réseau ni modèle
cd planner; uv run pytest -q      # solveur
cd mobile; npx tsc --noEmit; npx expo lint
```

## Ancienne version

`start.ps1` et `src/mentor/ui.py` sont le tout premier mentor sur une seule page (NiceGUI, <http://127.0.0.1:8765>, nécessite `DEEPSEEK_API_KEY`) ; il n'est plus mis à jour.
