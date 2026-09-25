# iCloud Drive sur iPhone et iPad

Le seul moyen gratuit d'atteindre un iPhone ou un iPad. Fonctionne avec un Mac, un autre appareil iOS, ou Windows via iCloud pour Windows.

## Mise en place

1. **Réglages → [votre nom] → iCloud → iCloud Drive** : activez **Synchroniser cet iPhone**.
2. Toujours dans les réglages iCloud, touchez **Tout afficher** et vérifiez que **Synesis** peut utiliser iCloud Drive.
3. Ouvrez l'app **Fichiers** → Explorer → **iCloud Drive**. Si le coffre a été créé sur un autre appareil, un dossier **Synesis** est déjà là ; ouvrez-le une fois pour que ses fichiers se téléchargent.
4. Lancez Synesis et choisissez *iCloud Drive* dans l'assistant. Le coffre apparaît sous *Synchronisé depuis …* ; touchez-le. Sinon choisissez *Créer* et Synesis crée le dossier dans iCloud Drive.

## Remarques

- iOS télécharge les fichiers à la demande. À la première ouverture d'un gros coffre, laissez-lui une minute en Wi-Fi ; Synesis indexe ce qui est présent et complète au fur et à mesure.
- Le mode économie d'énergie met iCloud en pause. Branchez l'appareil ou désactivez-le après une longue séance d'écriture.
- Modifier la même note sur iPhone et Mac en même temps fonctionne quand les deux sont en ligne ; les modifications hors ligne fusionnent à la reconnexion.

## Vérifier que ça marche

1. Sur cet appareil, créez une note (Capture rapide, `Ctrl/⌘ ⇧ N`) avec une ligne comme *test de synchro depuis cet appareil*.
2. Attendez que l'icône de l'outil de synchro indique que l'envoi est terminé.
3. Sur l'autre appareil, ouvrez Synesis (ou relancez-le). La note apparaît dans la barre latérale sous Notes, et l'Accueil la liste dans Récents.
4. Modifiez la même note sur les deux appareils pendant que l'un est hors ligne, puis reconnectez. Les deux modifications survivent : Synesis garde un journal de changements par appareil dans `.bible-study/sync/` et les fusionne ; l'outil de synchro n'a jamais de conflit à résoudre. S'il crée quand même un fichier « copie en conflit », supprimez cette copie : le texte fusionné est déjà dans le fichier d'origine.

## Bon à savoir

- Tout le dossier du coffre est synchronisé, y compris le dossier caché `.bible-study`. Ne l'excluez pas.
- Une seule instance de Synesis (ou d'Obsidian) à la fois doit éditer un fichier ; la fusion gère les modifications hors ligne, pas deux curseurs sur la même ligne à la même seconde.
- Réglages → Synchronisation liste chaque appareil qui a publié dans le coffre et la date de sa dernière publication.
