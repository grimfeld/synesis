# Syncthing sur Linux

Syncthing copie un dossier directement entre vos propres appareils, chiffré, sans compte ni nuage. Gratuit et open source sur Windows, macOS, Linux et Android (pas iOS). Les appareils se synchronisent dès que deux d'entre eux sont en ligne en même temps ; un appareil qui reste allumé (un ordinateur de bureau, un NAS) accélère les autres.

## Installation

1. Debian / Ubuntu : `sudo apt install syncthing`. Fedora : `sudo dnf install syncthing`. Arch : `sudo pacman -S syncthing`. Ou utilisez le dépôt officiel [apt.syncthing.net](https://apt.syncthing.net/) pour des versions récentes.
2. Démarrez-le pour votre utilisateur et à l'ouverture de session : `systemctl --user enable --now syncthing.service`.
3. Ouvrez l'interface web sur [http://127.0.0.1:8384](http://127.0.0.1:8384).

## Appairer les appareils

1. Sur cet appareil, ouvrez l'interface web de Syncthing (elle s'ouvre dans le navigateur ; l'icône de la barre d'état a *Ouvrir*). Sous **Actions → Afficher l'ID**, copiez le long **ID d'appareil**.
2. Sur l'autre appareil, **Ajouter un appareil distant**, collez l'ID, donnez-lui un nom, enregistrez. De retour sur cet appareil, acceptez l'invite *Nouvel appareil* qui apparaît dans l'interface.
3. Sur cet appareil, **Ajouter un partage** : choisissez le dossier du coffre Synesis (créé à l'étape suivante, ou déjà présent), étiquette *Synesis*, et sous **Partage** cochez l'autre appareil. Enregistrez.
4. Sur l'autre appareil, acceptez l'invite *Nouveau partage* et choisissez où le placer (`~/Sync/Synesis` est un bon défaut ; Synesis y regarde). La synchronisation démarre aussitôt.

## Réglages qui comptent

- **Type de partage** : *Envoi et réception* sur chaque appareil.
- **Versionnage** : facultatif. *Échelonné* garde d'anciennes copies dans `.stversions/`, hors de vue de Synesis.
- **Motifs d'exclusion** : aucun. Le dossier caché `.bible-study/` doit aussi se synchroniser.
- Donnez à chaque appareil un nom lisible ; Synesis l'affiche comme *Synchronisé depuis <nom>*.

Chemin de coffre suggéré sur Linux : `~/Sync/Synesis`.

## Vérifier que ça marche

1. Sur cet appareil, créez une note (Capture rapide, `Ctrl/⌘ ⇧ N`) avec une ligne comme *test de synchro depuis cet appareil*.
2. Attendez que l'icône de l'outil de synchro indique que l'envoi est terminé.
3. Sur l'autre appareil, ouvrez Synesis (ou relancez-le). La note apparaît dans la barre latérale sous Notes, et l'Accueil la liste dans Récents.
4. Modifiez la même note sur les deux appareils pendant que l'un est hors ligne, puis reconnectez. Les deux modifications survivent : Synesis garde un journal de changements par appareil dans `.bible-study/sync/` et les fusionne ; l'outil de synchro n'a jamais de conflit à résoudre. S'il crée quand même un fichier « copie en conflit », supprimez cette copie : le texte fusionné est déjà dans le fichier d'origine.

## Bon à savoir

- Tout le dossier du coffre est synchronisé, y compris le dossier caché `.bible-study`. Ne l'excluez pas.
- Une seule instance de Synesis (ou d'Obsidian) à la fois doit éditer un fichier ; la fusion gère les modifications hors ligne, pas deux curseurs sur la même ligne à la même seconde.
- Réglages → Synchronisation liste chaque appareil qui a publié dans le coffre et la date de sa dernière publication.
