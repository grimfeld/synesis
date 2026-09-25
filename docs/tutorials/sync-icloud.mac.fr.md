# iCloud Drive sur un Mac

Gratuit avec n'importe quel identifiant Apple (5 Go inclus ; un coffre de milliers de notes pèse quelques mégaoctets). Atteint chaque Mac, iPhone et iPad connecté au même identifiant Apple, et Windows via iCloud pour Windows.

## Mise en place

1. Ouvrez **Réglages Système → [votre nom] → iCloud → iCloud Drive** et vérifiez qu'iCloud Drive est **activé**.
2. Sous *Optimiser le stockage du Mac*, **désactivez** l'option pour un coffre fiable : sinon macOS peut renvoyer des fichiers dans le nuage et Synesis verrait un dossier vide jusqu'à leur retéléchargement.
3. Dans le Finder, ouvrez **iCloud Drive** (barre latérale) et créez un dossier **Synesis**. Son chemin est `~/Library/Mobile Documents/com~apple~CloudDocs/Synesis` ; Synesis le propose à l'étape suivante.
4. Créez le coffre dans ce dossier. Sur ce Mac, c'est tout.

## Sur vos autres appareils Apple

- **Autre Mac** : connectez le même identifiant Apple, activez iCloud Drive, lancez Synesis : il trouve le coffre sous *Synchronisé depuis ce Mac* et l'ouvre.
- **iPhone / iPad** : installez Synesis, ouvrez-le, choisissez *iCloud Drive* dans l'assistant ; le coffre apparaît dans Fichiers sous iCloud Drive → Synesis et Synesis le propose.

## Remarques

- iCloud synchronise fichier par fichier, en général en quelques secondes en Wi-Fi. Le premier envoi peut prendre quelques minutes.
- Si un fichier montre une icône de nuage avec une flèche dans le Finder, il n'est pas encore téléchargé. Clic droit → *Télécharger maintenant*, ou désactivez *Optimiser le stockage* comme ci-dessus.

## Vérifier que ça marche

1. Sur cet appareil, créez une note (Capture rapide, `Ctrl/⌘ ⇧ N`) avec une ligne comme *test de synchro depuis cet appareil*.
2. Attendez que l'icône de l'outil de synchro indique que l'envoi est terminé.
3. Sur l'autre appareil, ouvrez Synesis (ou relancez-le). La note apparaît dans la barre latérale sous Notes, et l'Accueil la liste dans Récents.
4. Modifiez la même note sur les deux appareils pendant que l'un est hors ligne, puis reconnectez. Les deux modifications survivent : Synesis garde un journal de changements par appareil dans `.bible-study/sync/` et les fusionne ; l'outil de synchro n'a jamais de conflit à résoudre. S'il crée quand même un fichier « copie en conflit », supprimez cette copie : le texte fusionné est déjà dans le fichier d'origine.

## Bon à savoir

- Tout le dossier du coffre est synchronisé, y compris le dossier caché `.bible-study`. Ne l'excluez pas.
- Une seule instance de Synesis (ou d'Obsidian) à la fois doit éditer un fichier ; la fusion gère les modifications hors ligne, pas deux curseurs sur la même ligne à la même seconde.
- Réglages → Synchronisation liste chaque appareil qui a publié dans le coffre et la date de sa dernière publication.
